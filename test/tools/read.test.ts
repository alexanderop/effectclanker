import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readHandler } from "../../src/tools/read.ts";
import { expectLeft, withTmpDir } from "../utilities.ts";

describe("readHandler", () => {
  it.effect("reads full file content", () =>
    withTmpDir("read", (dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "hello.txt");
        yield* Effect.promise(() => fs.writeFile(file, "alpha\nbeta\ngamma"));
        const result = yield* readHandler({ path: file });
        expect(result).toBe("alpha\nbeta\ngamma");
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("slices via offset + limit", () =>
    withTmpDir("read", (dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "lines.txt");
        yield* Effect.promise(() => fs.writeFile(file, "a\nb\nc\nd\ne"));
        const result = yield* readHandler({ path: file, offset: 1, limit: 2 });
        expect(result).toBe("b\nc");
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("fails with a FileNotFound tagged error when the file is missing", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(readHandler({ path: "/no/such/file/xyz123" }));
      expectLeft(result, "FileNotFound");
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});
