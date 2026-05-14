# Testing with Effect

> This doc is the _mechanics_. For _why_ the suite is shaped the way it
> is — the diamond pyramid, the no-real-LLM-in-CI rule, the three
> tiers — read [`../testing-strategy.md`](../testing-strategy.md) first.

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

## Resource setup with `withTmpDir`, `withTmpFile`, `writeFiles`

Three layered helpers in `test/utilities.ts`. Reach for the most specific
one that fits:

- **`withTmpFile(initial, use)`** — fresh tmp dir + a single file
  (`f.txt`) preloaded with `initial`. Use when the test only needs one
  file (read, edit, write tools).
- **`writeFiles(dir, { "a.ts": "", "sub/b.ts": "" })`** — seed a
  directory tree from a path-to-contents map. Intermediate dirs are
  created automatically; entries are written in parallel.
- **`withTmpDir(prefix, use)`** — the primitive. Use when the test needs
  to manipulate the directory itself (e.g. compute paths, mkdir later)
  or when files are seeded incrementally.

All three wrap `Effect.acquireUseRelease` so cleanup runs even on
failure or Effect interruption. The dir name is prefixed `ecl-<scope>-`
so leaked tmpdirs are attributable to a specific test.

```ts
import { withTmpFile, withTmpDir, writeFiles } from "../utilities.ts";

// Single-file test
it.effect("reads full file content", () =>
  withTmpFile("alpha\nbeta\ngamma", (file) =>
    Effect.gen(function* () {
      const result = yield* readHandler({ path: file });
      expect(result).toBe("alpha\nbeta\ngamma");
    }),
  ),
);

// Directory-tree test
it.effect("finds files matching **/*.ts", () =>
  withTmpDir("glob", (dir) =>
    Effect.gen(function* () {
      yield* writeFiles(dir, { "a.ts": "", "sub/b.ts": "", "c.txt": "" });
      const result = yield* globHandler({ pattern: "**/*.ts", cwd: dir });
      expect(result.toSorted()).toEqual(["a.ts", "sub/b.ts"]);
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

## Mocking the LLM — `runToolkit` + `mockText` / `mockToolCall`

Toolkit-via-mock tests script what the (fake) model would say, then run
the real toolkit and assert on the response.

The high-level helper is `runToolkit(options)`. It wraps the standard
incantation — `LanguageModel.generateText({ prompt, toolkit: HarnessToolkit })`
piped through `withLanguageModel` and provided with `HarnessToolkitLayer`.
Scripted parts come from the `mockText` and `mockToolCall` factories so
call sites don't open-code `Response.PartEncoded` shapes.

```ts
import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { mockText, mockToolCall, runToolkit, withTmpDir, writeFiles } from "./utilities.ts";

it.effect("dispatches a glob tool call to its handler", () =>
  withTmpDir("glob-dispatch", (dir) =>
    Effect.gen(function* () {
      yield* writeFiles(dir, { "a.ts": "", "b.ts": "" });
      const response = yield* runToolkit({
        prompt: "list ts files",
        parts: [mockToolCall("glob", { pattern: "**/*.ts", cwd: dir })],
      });

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolResults[0]?.result).toEqual(expect.any(Array));
    }),
  ),
);
```

Things to know:

- **`mockText(text)`** → `{ type: "text", text }`.
  **`mockToolCall(name, params, { id? })`** → `{ type: "tool-call", id, name, params }`.
  Auto-generates a unique id; pass `{ id }` to assert on a specific value.
  Both return `Response.PartEncoded`. Mirrors pi's `fauxText` / `fauxToolCall`.
- **`runToolkit({ prompt, parts })`** — `parts` is either an array OR a
  function `(opts) => parts | Effect<parts>`. Use the function form for
  multi-turn scenarios that need to branch on call number or inspect the
  incoming prompt.
- **The handlers are not mocked** — only the model. `runToolkit` provides
  `HarnessToolkitLayer`, so dispatched tool calls execute real handlers
  against the real filesystem.
- **Failure-channel assertions**: `runToolkit` returns an Effect, so you
  can chain `.pipe(Effect.flip)` to invert success/failure when asserting
  on the loop's _own_ error channel (e.g. `MalformedOutput` from schema
  decoding). See `test/toolkit.test.ts` for the pattern.

Multi-turn example — the `parts` function closes over a counter to return
different responses across calls:

```ts
it.effect("two-turn flow", () =>
  Effect.gen(function* () {
    let call = 0;
    const parts = () => {
      call++;
      return call === 1 ? [mockToolCall("glob", { pattern: "**/*.ts" })] : [mockText("done")];
    };

    const turn1 = yield* runToolkit({ prompt: "list files", parts });
    const turn2 = yield* runToolkit({ prompt: "anything else?", parts });
    expect(turn2.text).toBe("done");
  }),
);
```

### When to drop down to `withLanguageModel` directly

`runToolkit` is built on `withLanguageModel`, which is itself a mirror of
`repos/effect/packages/ai/ai/test/utilities.ts`. Drop down to it directly
only when you need to:

- Use a `Toolkit` other than `HarnessToolkit` (none exist yet).
- Script `streamText` instead of `generateText` (no current tests do
  this; the helper supports both).

For everything else, prefer `runToolkit` — the wrapped form keeps the
`generateText` + `pipe` + `Effect.provide` boilerplate out of test bodies.

Don't reach for either helper in handler-direct tests — those test the
handler, not the loop. Use them only when you need to assert behaviour
that involves the spec-to-handler wiring or the loop itself.

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

## Why the shell timeout test uses `it.live`, not `TestClock`

`shellHandler` (`packages/tools/src/shell.ts`) implements its timeout with
`Effect.race(process.exitCode, Effect.sleep(timeout))`. `Effect.sleep`
respects `TestClock`, so on the surface the test looks like it should be
mockable. It isn't — the racing process is started via
`@effect/platform`'s `Command.start`, which spawns a real OS child via
`CommandExecutor`, and the OS clock can't be advanced. Even if you call
`TestClock.adjust("60 seconds")`, the `setTimeout`-equivalent on the
`Effect.sleep` side fires instantly while the spawned process is still
running in wall time, and the race resolves to "timed out" before the
child has produced any output — so you can't assert on real exit behaviour.

The `shell.test.ts` "kills a long-running command past its timeout"
case is therefore an `it.live` test. Determinism here would require
mocking `CommandExecutor` with a fake-process implementation that
respects `TestClock`. That's a much larger change; until we need it,
the live test stays. Don't bother trying `TestClock` here — the failure
mode is non-obvious and you'll lose time.
