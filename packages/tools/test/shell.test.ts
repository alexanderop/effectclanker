import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import * as fs from "node:fs/promises";
import { ApprovalAutoApproveLayer, ApprovalDenyAllLayer } from "../src/approval-policy.ts";
import { shellHandler } from "../src/shell.ts";
import { TruncationStore, TruncationStoreLive } from "../src/truncate.ts";

const TestLayer = Layer.mergeAll(
  ApprovalAutoApproveLayer,
  TruncationStoreLive.pipe(Layer.provide(NodeContext.layer)),
  NodeContext.layer,
);

const FailingStoreLayer = Layer.mergeAll(
  ApprovalAutoApproveLayer,
  Layer.succeed(TruncationStore, { persist: () => Effect.succeed(null) }),
  NodeContext.layer,
);

describe("shellHandler", () => {
  it.effect("captures stdout for a successful command", () =>
    Effect.gen(function* () {
      const result = yield* shellHandler({ command: "echo hello" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
      expect(result.timedOut).toBe(false);
      expect(result.truncated).toBe(false);
      expect(result.outputPath).toBe(null);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("captures non-zero exit code and stderr", () =>
    Effect.gen(function* () {
      const result = yield* shellHandler({ command: "echo oops 1>&2; exit 3" });
      expect(result.exitCode).toBe(3);
      expect(result.stderr.trim()).toBe("oops");
    }).pipe(Effect.provide(TestLayer)),
  );

  // Uses live Clock so Effect.sleep advances in real time — TestClock would
  // block indefinitely while the OS process (real time) runs to completion.
  it.live("flags timeout when command exceeds timeoutMs", () =>
    Effect.gen(function* () {
      const result = yield* shellHandler({
        command: "sleep 2",
        timeoutMs: 100,
      });
      expect(result.timedOut).toBe(true);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("scrubs env — DANGEROUS_SECRET is not visible to the child", () =>
    Effect.gen(function* () {
      process.env["DANGEROUS_SECRET"] = "exposed";
      const result = yield* shellHandler({ command: "echo ${DANGEROUS_SECRET:-clean}" });
      delete process.env["DANGEROUS_SECRET"];
      expect(result.stdout.trim()).toBe("clean");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("truncates output past the 50 KiB cap (tail direction) and persists full output", () =>
    Effect.gen(function* () {
      // 60_000 bytes > 50 KiB. Use `printf` so the head is recognizable and we
      // can assert tail-direction by checking the LAST bytes are retained.
      const result = yield* shellHandler({
        command: "printf 'a%.0s' {1..60000}; printf 'END_MARKER'",
      });
      expect(result.truncated).toBe(true);
      expect(result.stdout.length).toBeLessThanOrEqual(50 * 1024);
      expect(result.stdout.endsWith("END_MARKER")).toBe(true);
      expect(result.outputPath).not.toBe(null);
      if (result.outputPath !== null) {
        const saved = yield* Effect.promise(() => fs.readFile(result.outputPath!, "utf8"));
        expect(saved).toContain("END_MARKER");
        // Full output preserved — the saved file holds more than the capped stdout.
        expect(saved.length).toBeGreaterThan(result.stdout.length);
        // The combined-marker between stdout and stderr is present.
        expect(saved).toContain("--- STDERR ---");
      }
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("returns outputPath: null when persistence fails", () =>
    Effect.gen(function* () {
      const result = yield* shellHandler({
        command: "printf 'a%.0s' {1..60000}",
      });
      expect(result.truncated).toBe(true);
      expect(result.outputPath).toBe(null);
      // The capped stdout still made it through; persistence failure didn't
      // abort the tool call.
      expect(result.stdout.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(FailingStoreLayer)),
  );

  it.effect("fails with ApprovalDenied when the policy denies the request", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(shellHandler({ command: "echo nope" }));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ApprovalDenied");
      }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ApprovalDenyAllLayer,
          TruncationStoreLive.pipe(Layer.provide(NodeContext.layer)),
          NodeContext.layer,
        ),
      ),
    ),
  );
});
