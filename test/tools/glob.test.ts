import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as path from "node:path";
import { globHandler } from "../../src/tools/glob.ts";
import { withTmpDir, writeFiles } from "../utilities.ts";

describe("globHandler", () => {
  it.effect("finds files matching **/*.ts in nested directories", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "a.ts": "", "sub/b.ts": "", "c.txt": "" });
        const result = yield* globHandler({ pattern: "**/*.ts", cwd: dir });
        // cwd-relative paths; exact match guards against extra hits.
        expect(result.toSorted()).toEqual(["a.ts", path.join("sub", "b.ts")].toSorted());
      }),
    ),
  );

  it.effect("'?' matches exactly one character", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "a1.ts": "", "a12.ts": "", "ab.ts": "" });
        const result = yield* globHandler({ pattern: "a?.ts", cwd: dir });
        expect(result.toSorted()).toEqual(["a1.ts", "ab.ts"]);
      }),
    ),
  );

  it.effect("'[a-z]' character class restricts matches", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "a.ts": "", "b.ts": "", "1.ts": "" });
        const result = yield* globHandler({ pattern: "[a-z].ts", cwd: dir });
        expect(result.toSorted()).toEqual(["a.ts", "b.ts"]);
      }),
    ),
  );

  it.effect("returns an empty array when no files match", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "a.ts": "" });
        const result = yield* globHandler({ pattern: "**/*.nope", cwd: dir });
        expect(result).toEqual([]);
      }),
    ),
  );

  it.effect("respects explicit cwd — files outside cwd are not matched", () =>
    withTmpDir("glob", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "inside/a.ts": "", "outside.ts": "" });
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
