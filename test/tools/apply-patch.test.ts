import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { applyPatchHandler } from "../../src/tools/apply-patch.ts";
import { expectLeft, withTmpDir } from "../utilities.ts";

describe("applyPatchHandler", () => {
  it.effect("adds a new file", () =>
    withTmpDir("apply", (dir) =>
      Effect.gen(function* () {
        const target = path.join(dir, "hello.txt");
        const patch = `*** Begin Patch
*** Add File: ${target}
+hello
+world
*** End Patch
`;
        const summary = yield* applyPatchHandler({ patch });
        expect(summary.added).toEqual([target]);
        const onDisk = yield* Effect.promise(() => fs.readFile(target, "utf8"));
        expect(onDisk).toBe("hello\nworld\n");
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("deletes an existing file", () =>
    withTmpDir("apply", (dir) =>
      Effect.gen(function* () {
        const target = path.join(dir, "old.txt");
        yield* Effect.promise(() => fs.writeFile(target, "stale"));
        const patch = `*** Begin Patch
*** Delete File: ${target}
*** End Patch
`;
        const summary = yield* applyPatchHandler({ patch });
        expect(summary.deleted).toEqual([target]);
        const stillThere = yield* Effect.promise(() =>
          fs
            .access(target)
            .then(() => true)
            .catch(() => false),
        );
        expect(stillThere).toBe(false);
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("updates an existing file via a hunk", () =>
    withTmpDir("apply", (dir) =>
      Effect.gen(function* () {
        const target = path.join(dir, "src.ts");
        yield* Effect.promise(() =>
          fs.writeFile(target, ["line one", "old line", "line three"].join("\n") + "\n"),
        );
        const patch = `*** Begin Patch
*** Update File: ${target}
@@
 line one
-old line
+new line
 line three
*** End Patch
`;
        const summary = yield* applyPatchHandler({ patch });
        expect(summary.updated).toEqual([target]);
        const onDisk = yield* Effect.promise(() => fs.readFile(target, "utf8"));
        expect(onDisk).toBe("line one\nnew line\nline three\n");
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("applies multiple hunks in a single Update File block", () =>
    withTmpDir("apply", (dir) =>
      Effect.gen(function* () {
        const target = path.join(dir, "src.ts");
        yield* Effect.promise(() =>
          fs.writeFile(
            target,
            ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].join("\n") + "\n",
          ),
        );
        const patch = `*** Begin Patch
*** Update File: ${target}
@@
 alpha
-beta
+BETA
 gamma
@@
 delta
-epsilon
+EPSILON
 zeta
*** End Patch
`;
        const summary = yield* applyPatchHandler({ patch });
        expect(summary.updated).toEqual([target]);
        const onDisk = yield* Effect.promise(() => fs.readFile(target, "utf8"));
        expect(onDisk).toBe("alpha\nBETA\ngamma\ndelta\nEPSILON\nzeta\n");
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("renames a file via '*** Move to:' and writes new content to the destination", () =>
    withTmpDir("apply", (dir) =>
      Effect.gen(function* () {
        const source = path.join(dir, "old.ts");
        const dest = path.join(dir, "new.ts");
        yield* Effect.promise(() =>
          fs.writeFile(source, ["one", "two", "three"].join("\n") + "\n"),
        );
        const patch = `*** Begin Patch
*** Update File: ${source}
*** Move to: ${dest}
@@
 one
-two
+TWO
 three
*** End Patch
`;
        const summary = yield* applyPatchHandler({ patch });
        expect(summary.moved).toEqual([{ from: source, to: dest }]);
        expect(summary.updated).toEqual([dest]);

        const sourceExists = yield* Effect.promise(() =>
          fs
            .access(source)
            .then(() => true)
            .catch(() => false),
        );
        expect(sourceExists).toBe(false);

        const onDisk = yield* Effect.promise(() => fs.readFile(dest, "utf8"));
        expect(onDisk).toBe("one\nTWO\nthree\n");
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("fails with ApplyPatchParseError when the envelope is missing", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(applyPatchHandler({ patch: "no envelope here" }));
      expectLeft(result, "ApplyPatchParseError");
    }).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect(
    "fails with ApplyPatchHunkFailed when hunk context is missing from the target file",
    () =>
      withTmpDir("apply", (dir) =>
        Effect.gen(function* () {
          const target = path.join(dir, "src.ts");
          yield* Effect.promise(() => fs.writeFile(target, "totally different content\n"));
          const patch = `*** Begin Patch
*** Update File: ${target}
@@
 line one
-old line
+new line
*** End Patch
`;
          const result = yield* Effect.either(applyPatchHandler({ patch }));
          expectLeft(result, "ApplyPatchHunkFailed");
        }),
      ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("fails with ApplyPatchHunkFailed when hunk context matches multiple locations", () =>
    withTmpDir("apply", (dir) =>
      Effect.gen(function* () {
        const target = path.join(dir, "src.ts");
        // The `foo` + `bar` pair appears twice; the hunk gives no
        // disambiguating context so the matcher must reject it.
        yield* Effect.promise(() =>
          fs.writeFile(target, ["foo", "bar", "baz", "foo", "bar", "qux"].join("\n") + "\n"),
        );
        const patch = `*** Begin Patch
*** Update File: ${target}
@@
 foo
-bar
+BAR
*** End Patch
`;
        const result = yield* Effect.either(applyPatchHandler({ patch }));
        const err = expectLeft(result, "ApplyPatchHunkFailed");
        if (err._tag !== "ApplyPatchHunkFailed") throw new Error("unreachable");
        expect(err.message).toMatch(/matches \d+ locations/);
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );
});
