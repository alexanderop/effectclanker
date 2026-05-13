# Testing with Effect

Two test styles, both in use, both required for a new tool.

| Style            | File location               | Drives                                      | Use when                                           |
| ---------------- | --------------------------- | ------------------------------------------- | -------------------------------------------------- |
| Handler-direct   | `test/tools/<name>.test.ts` | The exported `<name>Handler` function       | Testing tool logic in isolation. Fast and focused. |
| Toolkit-via-mock | `test/toolkit.test.ts`      | `LanguageModel.generateText` with a mock LM | Testing the spec ↔ handler ↔ toolkit wiring.       |

Both run under Vitest. Both use `@effect/vitest`'s `it.effect(...)`
helper, which lets a test body be an `Effect.Effect<...>` directly
instead of an async function.

---

## The `it.effect` pattern

```ts
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

describe("readHandler", () => {
  it.effect("reads full file content", () =>
    Effect.gen(function* () {
      const result = yield* readHandler({ path: "/etc/hostname" });
      expect(result.length).toBeGreaterThan(0);
    }),
  );
});
```

The test body is whatever Effect you return. Effect's runtime executes
it; assertion failures inside the generator are caught and reported by
Vitest normally. **Do not** use `async function*` — `it.effect` expects
a sync generator that yields effects.

## Resource setup with `withTmpDir`

Most handler tests need a tmp dir. Import the shared helper from
`test/utilities.ts` — it wraps `Effect.acquireUseRelease` so the cleanup
runs even on failure, and prefixes the dir name so leaked tmpdirs are
attributable to a specific test file.

```ts
import { withTmpDir } from "../utilities.ts";

it.effect("...", () =>
  withTmpDir("read", (dir) =>
    Effect.gen(function* () {
      const file = path.join(dir, "a.txt");
      yield* Effect.promise(() => fs.writeFile(file, "hi"));
      const result = yield* readHandler({ path: file });
      expect(result).toBe("hi");
    }),
  ),
);
```

This is a per-test pattern, not a hoisted `beforeEach` — each test owns
its own tmp dir, isolated from siblings.

## Asserting on Effect failures

`Effect.either` converts `Effect<A, E>` into `Effect<Either<E, A>>`. Pair it
with the `expectLeft` helper from `test/utilities.ts` — it asserts the
`_tag` and returns the typed error so you can keep asserting on its fields
without a second narrowing block.

```ts
import { expectLeft } from "../utilities.ts";

it.effect("fails with EditStringAmbiguous and an occurrence count", () =>
  withTmpFile("foo foo foo", (file) =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        editHandler({ path: file, oldString: "foo", newString: "bar" }),
      );
      const err = expectLeft(result, "EditStringAmbiguous");
      if (err._tag !== "EditStringAmbiguous") throw new Error("unreachable");
      expect(err.occurrences).toBe(3);
    }),
  ),
);
```

The redundant-looking `if (err._tag !== ...) throw` is purely there to
narrow the union type — `expectLeft` returns the full error union, but the
runtime assertion already guarantees the tag matches. TypeScript needs the
extra guard to surface the specific variant's fields.

`Effect.exit` is the alternative if you also want to distinguish defects
(thrown errors) from typed failures. For tool tests, `Effect.either` is
almost always enough.

---

## Mocking `LanguageModel` via `withLanguageModel`

Toolkit-via-mock tests use a copy of `@effect/ai`'s internal test helper.
It lives at `test/utilities.ts` and mirrors
`repos/effect/packages/ai/ai/test/utilities.ts` line-for-line.

Use it to script what the (fake) model would say:

```ts
import { LanguageModel } from "@effect/ai";
import { HarnessToolkit, HarnessToolkitLayer } from "../src/toolkit.ts";
import { withLanguageModel } from "./utilities.ts";

it.effect("dispatches a glob tool call to its handler", () =>
  Effect.gen(function* () {
    const response = yield* LanguageModel.generateText({
      prompt: "list ts files",
      toolkit: HarnessToolkit,
    }).pipe(
      withLanguageModel({
        generateText: [
          { type: "tool-call", id: "c1", name: "glob", params: { pattern: "src/**/*.ts" } },
        ],
      }),
      Effect.provide(HarnessToolkitLayer),
    );

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolResults[0]?.result).toEqual(expect.any(Array));
  }),
);
```

Things to know about `withLanguageModel`:

- `generateText` accepts an array of `Response.PartEncoded` parts, OR a
  function `(opts) => parts | Effect<parts>`. Use the function form if
  the mock needs to react to the conversation state.
- Each scripted part is a discriminated union — `{ type: "text", text }`,
  `{ type: "tool-call", id, name, params }`, etc.
- The framework runs the rest of the loop normally: it dispatches the
  scripted tool calls through the real `HarnessToolkitLayer`, executes
  real handlers, and assembles the final response. **The handlers are
  not mocked** — only the model is.
- For a multi-turn scenario where the mock returns different parts on
  each call, capture state in the function form:
  ```ts
  let call = 0;
  withLanguageModel({
    generateText: () => {
      call++;
      return call === 1
        ? [{ type: "tool-call", id: "c1", name: "glob", params: { pattern: "*" } }]
        : [{ type: "text", text: "done" }];
    },
  });
  ```

Don't reach for this helper in handler-direct tests — those test the
handler, not the loop. Use it only when you need to assert behaviour
that involves the spec-to-handler wiring or the loop itself (failure
handling, tool-call dispatch).

---

## Conventions

- **One test file per tool handler**: `test/tools/<name>.test.ts`.
- **One test file for end-to-end behaviour**: `test/toolkit.test.ts`.
- **Tmp dirs in `os.tmpdir()`** prefixed `ecl-<scope>-`. Always cleaned
  up via `Effect.acquireUseRelease`.
- **No mocking of `node:fs` / `node:child_process`.** The handler tests
  hit the real filesystem. We trade a few ms per test for catching
  encoding bugs, path bugs, permission bugs.
- **`expect(value).toMatchObject(partial)`** for shape assertions on
  partial structures; `expect(value).toEqual(full)` for exact equality.

---

## What to do when a test fails

1. Run just the one file: `bun run test test/tools/edit.test.ts`.
2. If it's an Effect failure surfacing as `_tag: "Left"`, log `result.left`
   to see the underlying error.
3. If a toolkit-via-mock test errors with an unexpected exception (not
   captured as `toolResult`), check that the underlying tool has
   `failureMode: "return"`. See
   [gotchas §1](../patterns/effect-ai-gotchas.md#1-set-failuremode-return-on-every-fallible-tool).

---

## Why the bash timeout test uses `it.live`, not `TestClock`

`bashHandler` (`src/tools/bash.ts`) implements its timeout with
`Effect.race(process.exitCode, Effect.sleep(timeout))`. `Effect.sleep`
respects `TestClock`, so on the surface the test looks like it should be
mockable. It isn't — the racing process is started via
`@effect/platform`'s `Command.start`, which spawns a real OS child via
`CommandExecutor`, and the OS clock can't be advanced. Even if you call
`TestClock.adjust("60 seconds")`, the `setTimeout`-equivalent on the
`Effect.sleep` side fires instantly while the spawned process is still
running in wall time, and the race resolves to "timed out" before the
child has produced any output — so you can't assert on real exit behaviour.

The `bash.test.ts` "kills a long-running command past its timeout"
case is therefore an `it.live` test. Determinism here would require
mocking `CommandExecutor` with a fake-process implementation that
respects `TestClock`. That's a much larger change; until we need it,
the live test stays. Don't bother trying `TestClock` here — the failure
mode is non-obvious and you'll lose time.
