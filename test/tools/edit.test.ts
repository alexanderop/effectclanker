import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import { editHandler } from "../../src/tools/edit.ts";
import { expectLeft, withTmpFile } from "../utilities.ts";

describe("editHandler", () => {
  it.effect("replaces a unique match", () =>
    withTmpFile("hello world", (file) =>
      Effect.gen(function* () {
        const result = yield* editHandler({
          path: file,
          oldString: "world",
          newString: "earth",
        });
        expect(result).toEqual({ replaced: 1 });
        const onDisk = yield* Effect.promise(() => fs.readFile(file, "utf8"));
        expect(onDisk).toBe("hello earth");
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect("fails with EditStringNotFound when oldString is missing", () =>
    withTmpFile("hello world", (file) =>
      Effect.gen(function* () {
        const result = yield* Effect.either(
          editHandler({ path: file, oldString: "missing", newString: "x" }),
        );
        expectLeft(result, "EditStringNotFound");
      }),
    ).pipe(Effect.provide(NodeContext.layer)),
  );

  it.effect(
    "fails with EditStringAmbiguous and an occurrence count when matches are ambiguous",
    () =>
      withTmpFile("foo foo foo", (file) =>
        Effect.gen(function* () {
          const result = yield* Effect.either(
            editHandler({ path: file, oldString: "foo", newString: "bar" }),
          );
          const err = expectLeft(result, "EditStringAmbiguous");
          if (err._tag !== "EditStringAmbiguous") throw new Error("unreachable");
          expect(err.occurrences).toBe(3);
        }),
      ).pipe(Effect.provide(NodeContext.layer)),
  );
});
