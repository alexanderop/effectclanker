import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { editHandler } from "../../src/tools/edit.ts";
import { expectLeft, withTmpDir } from "../utilities.ts";

const withTmpFile = <A, E, R>(
  initial: string,
  use: (file: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  withTmpDir("edit", (dir) =>
    Effect.gen(function* () {
      const file = path.join(dir, "f.txt");
      yield* Effect.promise(() => fs.writeFile(file, initial, "utf8"));
      return yield* use(file);
    }),
  );

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
