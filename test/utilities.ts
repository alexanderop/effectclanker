// Mirror of repos/effect/packages/ai/ai/test/utilities.ts so we get the
// canonical `withLanguageModel` mock without copy-paste drift in tests.
import * as LanguageModel from "@effect/ai/LanguageModel";
import type * as Response from "@effect/ai/Response";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Either from "effect/Either";
import { dual } from "effect/Function";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { HarnessToolkit, HarnessToolkitLayer } from "../src/toolkit.ts";

type GenerateInput =
  | Array<Response.PartEncoded>
  | ((
      options: LanguageModel.ProviderOptions,
    ) => Array<Response.PartEncoded> | Effect.Effect<Array<Response.PartEncoded>>);

type StreamInput =
  | Array<Response.StreamPartEncoded>
  | ((
      options: LanguageModel.ProviderOptions,
    ) => Array<Response.StreamPartEncoded> | Stream.Stream<Response.StreamPartEncoded>);

export interface WithLanguageModelOptions {
  readonly generateText?: GenerateInput;
  readonly streamText?: StreamInput;
}

export const withLanguageModel: {
  (
    options: WithLanguageModelOptions,
  ): <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, LanguageModel.LanguageModel>>;
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options: WithLanguageModelOptions,
  ): Effect.Effect<A, E, Exclude<R, LanguageModel.LanguageModel>>;
} = dual(
  2,
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options: WithLanguageModelOptions,
  ): Effect.Effect<A, E, Exclude<R, LanguageModel.LanguageModel>> =>
    Effect.provideServiceEffect(
      effect,
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText: (opts) => {
          if (Predicate.isUndefined(options.generateText)) {
            return Effect.succeed([]);
          }
          if (Array.isArray(options.generateText)) {
            return Effect.succeed(options.generateText);
          }
          const result = options.generateText(opts);
          return Effect.isEffect(result) ? result : Effect.succeed(result);
        },
        streamText: (opts) => {
          if (Predicate.isUndefined(options.streamText)) {
            return Stream.empty;
          }
          if (Array.isArray(options.streamText)) {
            return Stream.fromIterable(options.streamText);
          }
          const result = options.streamText(opts);
          return Array.isArray(result) ? Stream.fromIterable(result) : result;
        },
      }),
    ),
);

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

// Inspired by pi's `fauxText` / `fauxToolCall`; shape matches effect-ai's
// `Response.PartEncoded` (kebab-case `tool-call`, `params`), not pi's
// camelCase `toolCall` + `arguments`.
export const mockText = (text: string): Response.PartEncoded => ({ type: "text", text });

export const mockToolCall = (
  name: string,
  params: unknown,
  options: { id?: string } = {},
): Response.PartEncoded => ({
  type: "tool-call",
  id: options.id ?? randomUUID(),
  name,
  params,
});

// Wraps the standard Tier-2 incantation:
//   LanguageModel.generateText({ prompt, toolkit: HarnessToolkit })
//     .pipe(withLanguageModel({ generateText: parts }), Effect.provide(HarnessToolkitLayer))
// Callers can still chain `.pipe(Effect.flip, ...)` for failure assertions.
export const runToolkit = (options: {
  prompt: string;
  parts:
    | Array<Response.PartEncoded>
    | ((
        opts: LanguageModel.ProviderOptions,
      ) => Array<Response.PartEncoded> | Effect.Effect<Array<Response.PartEncoded>>);
}) =>
  LanguageModel.generateText({
    prompt: options.prompt,
    toolkit: HarnessToolkit,
  }).pipe(withLanguageModel({ generateText: options.parts }), Effect.provide(HarnessToolkitLayer));
