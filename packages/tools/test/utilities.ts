import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Either from "effect/Either";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

// Per-test tmp dir, cleaned up via `Effect.acquireUseRelease` even on failure.
// Prefix is included in the dir name to make ad-hoc tmpdir leaks attributable
// to a specific test file (`ecl-glob-`, `ecl-edit-`, etc.).
export const withTmpDir = <A, E, R>(
  prefix: string,
  use: (dir: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), `ecl-${prefix}-`))),
    use,
    (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
  );

// Filename is fixed (`f.txt`); callers needing a specific name use
// `withTmpDir` + `writeFiles`.
export const withTmpFile = <A, E, R>(
  initial: string,
  use: (file: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  withTmpDir("file", (dir) =>
    Effect.gen(function* () {
      const file = path.join(dir, "f.txt");
      yield* Effect.promise(() => fs.writeFile(file, initial, "utf8"));
      return yield* use(file);
    }),
  );

export const writeFiles = (dir: string, files: Record<string, string>): Effect.Effect<void> =>
  Effect.promise(async () => {
    await Promise.all(
      Object.entries(files).map(async ([relPath, content]) => {
        const full = path.join(dir, relPath);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content);
      }),
    );
  });

// Asserts a tagged-failure result and returns the typed error so callers can
// assert on additional fields without redoing the `_tag === "Left"` dance.
export const expectLeft = <A, E>(result: Either.Either<A, E>, tag: string): E => {
  expect(result._tag).toBe("Left");
  if (result._tag !== "Left") {
    throw new Error("expectLeft: result was not Left");
  }
  expect((result.left as { _tag?: string })._tag).toBe(tag);
  return result.left;
};
