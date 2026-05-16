import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import * as fs from "node:fs/promises";
import {
  MAX_BYTES,
  truncateHead,
  truncateLine,
  truncateTail,
  TruncationStore,
  TruncationStoreLive,
} from "../src/truncate.ts";

const LiveLayer = TruncationStoreLive.pipe(Layer.provide(NodeContext.layer));

// Stub layer for the FS-failure path. Mirrors the production service shape but
// always returns null from `persist`, simulating an ENOSPC / permissions /
// missing-dir scenario without needing to chmod the real tmpdir.
const FailingStoreLayer = Layer.succeed(TruncationStore, {
  persist: () => Effect.succeed(null),
});

describe("truncateHead", () => {
  it.effect("returns the input unchanged when under both caps", () =>
    Effect.gen(function* () {
      const result = yield* truncateHead("alpha\nbeta\ngamma");
      expect(result.truncated).toBe(false);
      expect(result.content).toBe("alpha\nbeta\ngamma");
      expect(result.outputLines).toBe(3);
    }).pipe(Effect.provide(LiveLayer)),
  );

  it.effect("truncates to maxLines and reports truncatedBy = lines", () =>
    Effect.gen(function* () {
      const lines = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
      const result = yield* truncateHead(lines, { maxLines: 2000 });
      expect(result.truncated).toBe(true);
      if (!result.truncated) return;
      expect(result.outputLines).toBe(2000);
      expect(result.totalLines).toBe(3000);
      expect(result.truncatedBy).toBe("lines");
    }).pipe(Effect.provide(LiveLayer)),
  );

  it.effect("truncates by bytes when one line pushes past the byte cap", () =>
    Effect.gen(function* () {
      // Each 'a'.repeat(100) line is ~101 bytes including newline. 600 of them
      // ≈ 60 KB, comfortably over a 50 KB byte cap but well under any line cap.
      const lines = Array.from({ length: 600 }, () => "a".repeat(100)).join("\n");
      const result = yield* truncateHead(lines, { maxBytes: 50 * 1024 });
      expect(result.truncated).toBe(true);
      if (!result.truncated) return;
      expect(result.truncatedBy).toBe("bytes");
      expect(result.outputBytes).toBeLessThanOrEqual(50 * 1024);
    }).pipe(Effect.provide(LiveLayer)),
  );

  it.effect("keeps whole lines only — no partial line at the byte boundary", () =>
    Effect.gen(function* () {
      const lines = Array.from({ length: 100 }, (_, i) => `line-${i}-${"x".repeat(50)}`).join("\n");
      const result = yield* truncateHead(lines, { maxBytes: 1024 });
      expect(result.content.endsWith("...")).toBe(false);
      // Every retained line must equal one of the original lines verbatim.
      const original = new Set(lines.split("\n"));
      for (const line of result.content.split("\n")) {
        expect(original.has(line)).toBe(true);
      }
    }).pipe(Effect.provide(LiveLayer)),
  );

  it.effect("persists full original content when truncated", () =>
    Effect.gen(function* () {
      const original = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
      const result = yield* truncateHead(original, { maxLines: 100 });
      expect(result.truncated).toBe(true);
      if (!result.truncated || result.outputPath === null) {
        throw new Error("expected truncated result with outputPath");
      }
      const saved = yield* Effect.promise(() => fs.readFile(result.outputPath, "utf8"));
      expect(saved).toBe(original);
    }).pipe(Effect.provide(LiveLayer)),
  );

  it.effect("returns outputPath: null when persistence fails", () =>
    Effect.gen(function* () {
      const original = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
      const result = yield* truncateHead(original, { maxLines: 100 });
      expect(result.truncated).toBe(true);
      if (!result.truncated) return;
      expect(result.outputPath).toBe(null);
      expect(result.content.split("\n")).toHaveLength(100);
    }).pipe(Effect.provide(FailingStoreLayer)),
  );
});

describe("truncateTail", () => {
  it.effect("keeps the last N lines, not the first", () =>
    Effect.gen(function* () {
      const lines = Array.from({ length: 3000 }, (_, i) => `line-${i}`).join("\n");
      const result = yield* truncateTail(lines, { maxLines: 2000 });
      expect(result.truncated).toBe(true);
      if (!result.truncated) return;
      expect(result.outputLines).toBe(2000);
      const out = result.content.split("\n");
      expect(out[0]).toBe("line-1000");
      expect(out[out.length - 1]).toBe("line-2999");
    }).pipe(Effect.provide(LiveLayer)),
  );

  it.effect("respects the byte cap from the tail side", () =>
    Effect.gen(function* () {
      const lines = Array.from({ length: 600 }, () => "a".repeat(100)).join("\n");
      const result = yield* truncateTail(lines, { maxBytes: 50 * 1024 });
      expect(result.truncated).toBe(true);
      if (!result.truncated) return;
      expect(result.outputBytes).toBeLessThanOrEqual(50 * 1024);
      expect(result.truncatedBy).toBe("bytes");
    }).pipe(Effect.provide(LiveLayer)),
  );
});

describe("truncateLine", () => {
  it("passes through lines at or under the max", () => {
    expect(truncateLine("abc", 10)).toEqual({ text: "abc", wasTruncated: false });
    expect(truncateLine("0123456789", 10)).toEqual({ text: "0123456789", wasTruncated: false });
  });

  it("truncates with a labeled suffix", () => {
    const result = truncateLine("a".repeat(20), 10);
    expect(result.wasTruncated).toBe(true);
    expect(result.text.startsWith("aaaaaaaaaa...")).toBe(true);
    expect(result.text).toContain("[line truncated to 10 chars]");
  });
});

describe("TruncationStoreLive constants", () => {
  it("MAX_BYTES matches the documented ITPM-aware budget", () => {
    // Cap value is load-bearing for the rate-limit math; if this changes,
    // docs/adr/0003 and the inline hint strings need to follow.
    expect(MAX_BYTES).toBe(50 * 1024);
  });
});
