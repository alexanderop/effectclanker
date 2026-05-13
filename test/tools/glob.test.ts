import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { globHandler } from "../../src/tools/glob.ts";
import { withTmpDir } from "../utilities.ts";

describe("globHandler", () => {
  it.effect("finds files matching **/*.ts in nested directories", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(dir, "a.ts"), "");
          await fs.mkdir(path.join(dir, "sub"));
          await fs.writeFile(path.join(dir, "sub", "b.ts"), "");
          await fs.writeFile(path.join(dir, "c.txt"), "");
        });
        const result = yield* globHandler({ pattern: "**/*.ts", cwd: dir });
        // cwd-relative paths; exact match guards against extra hits.
        expect(result.toSorted()).toEqual(["a.ts", path.join("sub", "b.ts")].toSorted());
      }),
    ),
  );

  it.effect("'?' matches exactly one character", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(dir, "a1.ts"), "");
          await fs.writeFile(path.join(dir, "a12.ts"), "");
          await fs.writeFile(path.join(dir, "ab.ts"), "");
        });
        const result = yield* globHandler({ pattern: "a?.ts", cwd: dir });
        expect(result.toSorted()).toEqual(["a1.ts", "ab.ts"]);
      }),
    ),
  );

  it.effect("'[a-z]' character class restricts matches", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(dir, "a.ts"), "");
          await fs.writeFile(path.join(dir, "b.ts"), "");
          await fs.writeFile(path.join(dir, "1.ts"), "");
        });
        const result = yield* globHandler({ pattern: "[a-z].ts", cwd: dir });
        expect(result.toSorted()).toEqual(["a.ts", "b.ts"]);
      }),
    ),
  );

  it.effect("returns an empty array when no files match", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "a.ts"), ""));
        const result = yield* globHandler({ pattern: "**/*.nope", cwd: dir });
        expect(result).toEqual([]);
      }),
    ),
  );

  it.effect("respects explicit cwd — files outside cwd are not matched", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(dir, "inside"));
          await fs.writeFile(path.join(dir, "inside", "a.ts"), "");
          // Sibling that's outside the configured cwd.
          await fs.writeFile(path.join(dir, "outside.ts"), "");
        });
        const result = yield* globHandler({
          pattern: "**/*.ts",
          cwd: path.join(dir, "inside"),
        });
        expect(result.toSorted()).toEqual(["a.ts"]);
      }),
    ),
  );

  // NOTE: We don't test glob error cases here. Node's `fs.glob` is permissive —
  // a nonexistent cwd yields an empty iterator rather than throwing, and the
  // accepted pattern grammar is broad enough that we couldn't find an input
  // that reliably trips the `FileIOError` catch clause. If you need to verify
  // that wiring, exercise it via `Effect.either` in a toolkit-level test.
});
