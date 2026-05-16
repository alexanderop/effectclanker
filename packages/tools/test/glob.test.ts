import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import * as path from "node:path";
import { globHandler } from "../src/glob.ts";
import { TruncationStoreLive } from "../src/truncate.ts";
import { withTmpDir, writeFiles } from "./utilities.ts";

const TestLayer = TruncationStoreLive.pipe(Layer.provideMerge(NodeContext.layer));

describe("globHandler", () => {
  it.effect("finds files matching **/*.ts as a newline-joined string", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "a.ts": "", "sub/b.ts": "", "c.txt": "" });
        const result = yield* globHandler({ pattern: "**/*.ts", cwd: dir });
        // cwd-relative paths; exact match guards against extra hits.
        expect(result.split("\n").toSorted()).toEqual(
          ["a.ts", path.join("sub", "b.ts")].toSorted(),
        );
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("'?' matches exactly one character", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "a1.ts": "", "a12.ts": "", "ab.ts": "" });
        const result = yield* globHandler({ pattern: "a?.ts", cwd: dir });
        expect(result.split("\n").toSorted()).toEqual(["a1.ts", "ab.ts"]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("'[a-z]' character class restricts matches", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "a.ts": "", "b.ts": "", "1.ts": "" });
        const result = yield* globHandler({ pattern: "[a-z].ts", cwd: dir });
        expect(result.split("\n").toSorted()).toEqual(["a.ts", "b.ts"]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("returns an empty string when no files match", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "a.ts": "" });
        const result = yield* globHandler({ pattern: "**/*.nope", cwd: dir });
        expect(result).toBe("");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("respects explicit cwd — files outside cwd are not matched", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "inside/a.ts": "", "outside.ts": "" });
        const result = yield* globHandler({
          pattern: "**/*.ts",
          cwd: path.join(dir, "inside"),
        });
        expect(result).toBe("a.ts");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("caps at 200 entries and appends the limit hint", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        const files = Object.fromEntries(
          Array.from({ length: 250 }, (_, i) => [`f${i}.ts`, ""] as const),
        );
        yield* writeFiles(dir, files);
        const result = yield* globHandler({ pattern: "**/*.ts", cwd: dir });
        const bodyLines = result.split("\n").filter((l) => l.endsWith(".ts"));
        expect(bodyLines).toHaveLength(200);
        expect(result).toContain("Refine the pattern.");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  // NOTE: We don't test glob error cases here. Node's `fs.glob` is permissive —
  // a nonexistent cwd yields an empty iterator rather than throwing, and the
  // accepted pattern grammar is broad enough that we couldn't find an input
  // that reliably trips the `FileIOError` catch clause. If you need to verify
  // that wiring, exercise it via `Effect.either` in a toolkit-level test.
});
