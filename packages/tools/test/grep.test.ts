import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { grepHandler } from "../src/grep.ts";
import { expectLeft, withTmpDir } from "./utilities.ts";

describe("grepHandler", () => {
  it.effect("finds matches across nested files", () =>
    withTmpDir("grep", (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(dir, "a.txt"), "hello\nworld");
          await fs.mkdir(path.join(dir, "sub"));
          await fs.writeFile(path.join(dir, "sub", "b.txt"), "another hello here");
        });
        const result = yield* grepHandler({ pattern: "hello", path: dir });
        expect(result).toHaveLength(2);
        const texts = result.map((m) => m.text).toSorted();
        expect(texts).toEqual(["another hello here", "hello"]);
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("respects caseInsensitive flag", () =>
    withTmpDir("grep", (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "a.txt"), "HELLO World"));
        const result = yield* grepHandler({
          pattern: "hello",
          path: dir,
          caseInsensitive: true,
        });
        expect(result).toHaveLength(1);
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("skips node_modules and dotfiles", () =>
    withTmpDir("grep", (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(dir, "node_modules"));
          await fs.writeFile(path.join(dir, "node_modules", "x.txt"), "skipme");
          await fs.writeFile(path.join(dir, ".hidden"), "skipme");
          await fs.writeFile(path.join(dir, "visible.txt"), "skipme");
        });
        const result = yield* grepHandler({ pattern: "skipme", path: dir });
        expect(result).toHaveLength(1);
        expect(result[0]!.file).toContain("visible.txt");
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("fails with InvalidRegex on a bad pattern", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(grepHandler({ pattern: "(unclosed" }));
      expectLeft(result, "InvalidRegex");
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});
