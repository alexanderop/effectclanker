import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { readHandler } from "../src/read.ts";
import { expectLeft, withTmpFile } from "./utilities.ts";

describe("readHandler", () => {
  it.effect("reads full file content", () =>
    withTmpFile("alpha\nbeta\ngamma", (file) =>
      Effect.gen(function* () {
        const result = yield* readHandler({ path: file });
        expect(result).toBe("alpha\nbeta\ngamma");
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("slices via offset + limit", () =>
    withTmpFile("a\nb\nc\nd\ne", (file) =>
      Effect.gen(function* () {
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
