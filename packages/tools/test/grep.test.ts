import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { grepHandler } from "../src/grep.ts";
import { TruncationStoreLive } from "../src/truncate.ts";
import { expectLeft, withTmpDir } from "./utilities.ts";

const TestLayer = TruncationStoreLive.pipe(Layer.provideMerge(NodeContext.layer));

describe("grepHandler", () => {
  it.effect("finds matches across nested files, formatted as file:line: text", () =>
    withTmpDir("grep", (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(dir, "a.txt"), "hello\nworld");
          await fs.mkdir(path.join(dir, "sub"));
          await fs.writeFile(path.join(dir, "sub", "b.txt"), "another hello here");
        });
        const result = yield* grepHandler({ pattern: "hello", path: dir });
        // Format is `path:line: text`; collect lines, ignore order.
        const lines = result.split("\n").toSorted();
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain("a.txt:1: hello");
        expect(lines[1]).toContain("b.txt:1: another hello here");
      }),
    ).pipe(Effect.provide(TestLayer)),
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
        expect(result).toContain("HELLO World");
      }),
    ).pipe(Effect.provide(TestLayer)),
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
        const lines = result.split("\n");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("visible.txt");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("fails with InvalidRegex on a bad pattern", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(grepHandler({ pattern: "(unclosed" }));
      expectLeft(result, "InvalidRegex");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("returns no matches as empty string", () =>
    withTmpDir("grep", (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "a.txt"), "nothing here"));
        const result = yield* grepHandler({ pattern: "xyz123", path: dir });
        expect(result).toBe("");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("caps at 100 matches and appends the limit hint", () =>
    withTmpDir("grep", (dir) =>
      Effect.gen(function* () {
        // 150 lines all matching — exceeds the 100-match cap.
        const lines = Array.from({ length: 150 }, () => "x").join("\n");
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "many.txt"), lines));
        const result = yield* grepHandler({ pattern: "x", path: dir });
        const bodyLines = result.split("\n").filter((l) => l.includes("many.txt"));
        expect(bodyLines).toHaveLength(100);
        expect(result).toContain("[100 matches limit reached. Refine the pattern.]");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("truncates long match lines to 500 chars", () =>
    withTmpDir("grep", (dir) =>
      Effect.gen(function* () {
        const longLine = "needle" + "x".repeat(2000);
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "a.txt"), longLine));
        const result = yield* grepHandler({ pattern: "needle", path: dir });
        expect(result).toContain("[line truncated to 500 chars]");
        expect(result).not.toContain("x".repeat(1000));
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
