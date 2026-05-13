import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { writeHandler } from "../../src/tools/write.ts";
import { withTmpDir } from "../utilities.ts";

describe("writeHandler", () => {
  it.effect("writes content to a fresh file", () =>
    withTmpDir("write", (dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "out.txt");
        const result = yield* writeHandler({ path: file, content: "hello world" });
        expect(result).toEqual({ bytesWritten: 11 });
        const onDisk = yield* Effect.promise(() => fs.readFile(file, "utf8"));
        expect(onDisk).toBe("hello world");
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("creates missing parent directories", () =>
    withTmpDir("write", (dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "deep", "nested", "out.txt");
        yield* writeHandler({ path: file, content: "x" });
        const onDisk = yield* Effect.promise(() => fs.readFile(file, "utf8"));
        expect(onDisk).toBe("x");
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("overwrites existing files", () =>
    withTmpDir("write", (dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "out.txt");
        yield* Effect.promise(() => fs.writeFile(file, "old"));
        yield* writeHandler({ path: file, content: "new" });
        const onDisk = yield* Effect.promise(() => fs.readFile(file, "utf8"));
        expect(onDisk).toBe("new");
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );
});
