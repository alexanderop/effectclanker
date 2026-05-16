import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import * as fs from "node:fs/promises";
import { readHandler } from "../src/read.ts";
import { TruncationStoreLive } from "../src/truncate.ts";
import { expectLeft, withTmpDir, withTmpFile } from "./utilities.ts";

const TestLayer = TruncationStoreLive.pipe(Layer.provideMerge(NodeContext.layer));

describe("readHandler", () => {
  it.effect("reads full file content", () =>
    withTmpFile("alpha\nbeta\ngamma", (file) =>
      Effect.gen(function* () {
        const result = yield* readHandler({ path: file });
        expect(result).toBe("alpha\nbeta\ngamma");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("slices via offset + limit", () =>
    withTmpFile("a\nb\nc\nd\ne", (file) =>
      Effect.gen(function* () {
        const result = yield* readHandler({ path: file, offset: 1, limit: 2 });
        expect(result).toBe("b\nc");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("fails with a FileNotFound tagged error when the file is missing", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(readHandler({ path: "/no/such/file/xyz123" }));
      expectLeft(result, "FileNotFound");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("fails with an IsADirectory tagged error when the path is a directory", () =>
    withTmpDir("read-dir", (dir) =>
      Effect.gen(function* () {
        const result = yield* Effect.either(readHandler({ path: dir }));
        expectLeft(result, "IsADirectory");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("appends a continuation hint when truncated by lines", () =>
    withTmpFile(Array.from({ length: 2500 }, (_, i) => `line-${i}`).join("\n"), (file) =>
      Effect.gen(function* () {
        const result = yield* readHandler({ path: file });
        expect(result).toContain("[Showing lines 1-2000 of 2500. Use offset=2000 to continue.");
        // The saved-file suffix lives in the same bracket; verify path exists.
        const match = result.match(/Saved to (\S+) /);
        expect(match).not.toBe(null);
        if (match) {
          const saved = yield* Effect.promise(() => fs.readFile(match[1]!, "utf8"));
          expect(saved.split("\n")).toHaveLength(2500);
        }
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("truncates pathologically long lines to the per-line cap", () =>
    withTmpFile("short\n" + "a".repeat(5000) + "\nshort", (file) =>
      Effect.gen(function* () {
        const result = yield* readHandler({ path: file });
        // The long line should carry the truncation suffix; no full 5k 'a's.
        expect(result).toContain("[line truncated to 2000 chars]");
        expect(result).not.toContain("a".repeat(2500));
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
