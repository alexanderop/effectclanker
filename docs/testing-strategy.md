# Testing strategy

> The mechanics of _how_ to write a test (`it.effect`, `withLanguageModel`,
> `expectLeft`, tmp-dir helpers) live in
> [`guides/testing.md`](./guides/testing.md). This doc is about _what to
> test, at what level, and why_ — the shape of the pyramid.

## The cost constraint

Every real call to Anthropic costs money and takes seconds. If CI runs a
real-API test on every PR we will (a) bleed budget, (b) get flaky from
upstream hiccups, and (c) be unable to test failure paths the provider
won't reproduce on demand. Therefore:

**No CI test ever hits a real LLM provider.**

This is the same posture our two reference projects take, arrived at
independently:

| Project | LLM in CI? | How                                                                                                                                                          |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pi`    | Never      | `faux` provider (`repos/pi/packages/ai/src/providers/faux.ts`) + `describe.skipIf(!process.env.…)` gates; CI explicitly `unset`s API keys before `npm test`. |
| `codex` | Never      | WireMock + fixture SSE responses (`repos/codex/codex-rs/app-server/tests/common/mock_model_server.rs`). Zero env-gated path even for developers.             |
| us      | Never      | `withLanguageModel` (`test/utilities.ts`) — provides a fake `LanguageModel` service via `Effect.provideServiceEffect`.                                       |

`pi` keeps a developer-only smoke tier behind env gates; `codex` doesn't.
**We follow `pi`** — see [§ Tier 3](#tier-3--real-api-smoke-developer-only)
for the rationale.

## The shape is a diamond, not a pyramid

A classic test pyramid (lots of units, few integration, fewer e2e) doesn't
fit an agent harness. The interesting bugs aren't in pure functions —
they're in the turn loop, tool dispatch, streaming, schema decoding, and
`failureMode` plumbing. Both `pi` and `codex` are heavy in the middle:

```
        ▲    Tier 3 — real-API smoke    (dev-only, env-gated, ~0% of suite)
       ▲▲▲   Tier 2 — mocked-LLM        (the bulk, ~60–70% of suite)
      ▲▲▲▲▲  Tier 1 — handler-direct    (~30–40% of suite)
```

If you write a new tool, you write at least one test in Tier 1 _and_ one
in Tier 2. Tier 3 is opt-in.

---

## Tier 1 — Handler-direct (pure logic + real I/O)

**What it tests**: a single tool's handler function in isolation. Schema
decoding, business logic, filesystem behaviour, error tags.

**What is real**: `node:fs`, `node:child_process`, tmp directories.
**What is mocked**: nothing. There is no `LanguageModel` in scope.

**Where**: `test/tools/<name>.test.ts` — one file per tool.

**Effect primitives in use**:

- `it.effect(...)` from `@effect/vitest` — runs the body as an `Effect`,
  injects `TestServices` (TestClock, TestRandom, etc.) automatically.
  Source: `repos/effect/packages/vitest/src/index.ts`.
- `withTmpDir(prefix, use)` — wraps `Effect.acquireUseRelease` so cleanup
  runs even on failure. See `test/utilities.ts:79`.
- `Effect.either` + `expectLeft` — assert a typed failure and narrow it.
  See `test/utilities.ts:91`.
- `it.live` — opt out of `TestClock` for the _one_ case where it doesn't
  work (spawned-process timeout in `shell.test.ts`; rationale in
  `guides/testing.md` § "Why the shell timeout test uses `it.live`").

**Do not** mock `node:fs` or `node:child_process` at this tier — the few
milliseconds of real I/O catch encoding, path, and permission bugs that
mocked fs hides. Same call we make as `pi` (`pi`'s tool tests also hit
the real filesystem; see `repos/pi/packages/coding-agent/test/`).

**Example** — `test/tools/edit.test.ts` exercises `editHandler` directly,
writes real files, and asserts on `EditStringAmbiguous._tag` and its
`occurrences` field.

---

## Tier 2 — Mocked-LLM integration (the bulk)

**What it tests**: the wiring — `Tool` spec ↔ handler ↔ `Toolkit` ↔
`LanguageModel.generateText` loop. Tool-call dispatch, schema decoding at
the call site, `failureMode: "return"` behaviour, multi-turn flows.

**What is real**: the toolkit, every handler, the filesystem, the entire
Effect runtime.
**What is mocked**: only the `LanguageModel` service. We script what the
model "says" via `withLanguageModel({ generateText: […] })`.

**Where**: `test/toolkit.test.ts` (and any future loop-level tests).

**Effect primitives in use**:

- `Effect.provideServiceEffect(eff, LanguageModel.LanguageModel, fake)` —
  the foundation `withLanguageModel` is built on. We swap a single
  service rather than a whole `Layer`. Mirrors `@effect/ai`'s own test
  helper at `repos/effect/packages/ai/ai/test/utilities.ts:8-70`.
- `withLanguageModel({ generateText: parts | (opts) => parts })` — accepts
  either a static parts array or a function that captures state across
  calls (used for multi-turn assertions; see `toolkit.test.ts:97-144`).
- `Effect.flip` — invert success/failure for assertions on the _error_
  channel of the loop itself (e.g. `MalformedOutput` when scripted
  params fail schema decoding; see `toolkit.test.ts:146-174`).
- `Effect.provide(HarnessToolkitLayer)` — provide the real handler layer
  so dispatched tool calls execute against the real toolkit.

**Two distinct failure surfaces to test here** (both already covered in
`toolkit.test.ts`):

1. _Handler_ failure with `failureMode: "return"` — error appears in
   `response.toolResults[i].result` with `isFailure: true`. The loop
   continues.
2. _Schema decoding_ failure on tool-call params — surfaces as
   `MalformedOutput` in the Effect's error channel (not as a tool result).

This is the tier that catches the bugs `@effect/ai` users actually hit.
The matching tests in `@effect/ai` itself live at
`repos/effect/packages/ai/ai/test/LanguageModel.test.ts` and `Tool.test.ts`.

---

## Tier 3 — Real-API smoke (developer-only)

**What it tests**: that `@effect/ai-anthropic`'s wire format hasn't
drifted from what Anthropic actually returns. One or two end-to-end
prompts against the real model. Nothing more.

**What is real**: everything, including the LLM.
**What is mocked**: nothing.

**Where**: `test/smoke/*.test.ts` (does not yet exist — add when the
first contract regression is felt).

**Effect primitives in use**:

- `it.live` — real time, real network, no test services. Required
  because retries / timeouts use real wall clock.
- Standard env-gate: `it.skipIf(!process.env.ANTHROPIC_API_KEY)("…", …)`.
  Mirrors `pi`'s `repos/pi/packages/ai/test/anthropic-opus-4-7-smoke.test.ts`
  pattern.

**CI rule**: the `bun run check` pipeline must run with
`ANTHROPIC_API_KEY` unset so these tests skip. Add an explicit `unset`
step in CI before `bun run test` once Tier 3 exists.

**Why we keep this tier even though `codex` doesn't**: we are a learning
harness, and the value of "still works against real Claude" is high
relative to the cost (a developer running it manually once before a
release). `codex` is shipped software with a paid team writing fixtures
deliberately; we're not. If Tier 3 ever becomes flaky or slow enough to
discourage running it, drop it — `codex`'s zero-real-call posture is also
defensible.

---

## What we deliberately do not do

- **No `vi.mock("node:fs")` / no handler mocking.** Tier 1 hits the real
  filesystem on purpose.
- **No `TestClock` for spawned processes.** `Effect.sleep` respects
  `TestClock`, but `@effect/platform`'s `Command.start` spawns a real OS
  child whose wall-clock can't be advanced. The shell timeout test uses
  `it.live` instead. Full rationale in `guides/testing.md:188`.
- **No snapshot tests of `Response` parts.** The encoded shape changes
  between `@effect/ai` versions; asserting on specific fields
  (`response.text`, `response.toolCalls[i].name`) is more durable.
- **No recorded cassettes / VCR.** `codex` uses hand-written fixture
  builders rather than recorded replays; we use scripted `generateText`
  parts via `withLanguageModel`, which is the same idea expressed as an
  Effect. If a future case is too tedious to script by hand, add a JSON
  fixture loader before reaching for a cassette library.
- **No CI step that requires an API key.** Ever. Adding one is a
  strategy change and warrants its own ADR.

---

## Worked examples from `pi`

Three tests from `pi`, one per tier, to show the shape concretely. `pi`
uses Vitest + a `faux` provider rather than Effect + `withLanguageModel`,
but the _strategy_ is the same — the snippets translate one-for-one to
our stack.

> Naming gotcha: `pi`'s `packages/agent/test/e2e.test.ts` runs against
> the **faux** provider, not the real API. By their convention "e2e"
> means "full agent loop", not "real network". In our taxonomy that file
> is **Tier 2**, not Tier 3. `pi`'s actual Tier-3 equivalent is
> `*-smoke.test.ts` and `*-e2e.test.ts` files in `packages/ai/test/`,
> all of which are env-gated.

### Tier 1 — pure unit, no LLM

`repos/pi/packages/ai/test/anthropic-sse-parsing.test.ts` constructs raw
SSE byte streams and feeds them through the Anthropic stream parser. No
provider, no agent, no network — just the parser:

```ts
function createSseResponse(events: Array<{ event: string; data: string }>): Response {
  const body = events.map(({ event, data }) => `event: ${event}\ndata: ${data}\n`).join("\n");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const minimalAnthropicEvents = [
  {
    event: "message_start",
    data: JSON.stringify({
      /* … */
    }),
  },
  {
    event: "content_block_delta",
    data: JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    }),
  },
  // …
];
```

**Maps to our Tier 1.** Equivalent in our codebase: `test/tools/<name>.test.ts` —
exercise the unit (parser there, handler here) against real inputs, no LLM in scope.

### Tier 2 — mocked-LLM agent loop

`repos/pi/packages/agent/test/e2e.test.ts` runs the full `Agent`
class — prompts, tool calls, streaming events — but the model is the
faux provider:

```ts
async function toolExecution(model: Model<string>) {
  const agent = new Agent({
    initialState: {
      systemPrompt: "You are a helpful assistant. Always use the calculator tool for math.",
      model, // ← faux model, scripted responses
      thinkingLevel: "off",
      tools: [calculateTool],
    },
  });

  await agent.prompt("Calculate 123 * 456 using the calculator tool.");

  const toolResultMsg = agent.state.messages.find((m) => m.role === "toolResult");
  expect(getTextContent(toolResultMsg!)).toContain("123 * 456 = 56088");
}
```

The `model` argument is the faux registration's `getModel()` — `pi`'s
equivalent of our `withLanguageModel({ generateText: […] })`. The
**toolkit, tool dispatch, and message threading are all real**; only the
model is fake.

**Maps to our Tier 2.** Equivalent in our codebase: `test/toolkit.test.ts` —
real toolkit, real handlers, scripted `LanguageModel`.

### Tier 3 — real-API smoke (env-gated)

`repos/pi/packages/ai/test/anthropic-opus-4-7-smoke.test.ts` calls real
Claude Opus 4.7 with a deterministic-answer prompt:

```ts
describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Anthropic Opus 4.7 smoke", () => {
  it("streams Claude Opus 4.7 with reasoning enabled", { retry: 2, timeout: 30000 }, async () => {
    const model = getModel("anthropic", "claude-opus-4-7");
    const s = streamSimple(model, makeContext(), { reasoning: "high", maxTokens: 1024 });

    for await (const event of s) {
      /* … track thinking events */
    }
    const response = await s.result();

    expect(response.stopReason).toBe("stop");
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    expect(text).toBe("sum=353418362; divisibleBy11=yes");
  });
});
```

Three details worth copying when we add our first Tier-3 test:

1. **`describe.skipIf(!process.env.ANTHROPIC_API_KEY)`** at the _describe_
   level, not the _it_ level — the entire block disappears if the key is
   absent, so CI doesn't even report skipped tests.
2. **`{ retry: 2, timeout: 30000 }`** — the network is real, so brief
   provider hiccups would otherwise flake the run. Two retries, 30s cap.
3. **Deterministic-answer prompt** ("sum=353418362; divisibleBy11=yes") —
   a smoke test against an LLM is only useful if the assertion is exact.
   Don't smoke-test "the response mentions Paris"; smoke-test a math
   answer or a regex-matched format string.

**Maps to our Tier 3.** Equivalent in our codebase: `test/smoke/*.test.ts`
(does not yet exist). Use `it.live` instead of `it.effect` so real time
governs the retry/timeout budget.

---

## When you add a new tool

The recipe in [`guides/adding-a-tool.md`](./guides/adding-a-tool.md)
already covers this, but for completeness:

1. **Tier 1**: one `test/tools/<name>.test.ts` exercising every typed
   failure tag the handler can return, plus the happy path.
2. **Tier 2**: at least one case in `test/toolkit.test.ts` proving the
   tool is dispatched correctly from a scripted `tool-call` part. Add a
   second case for any non-obvious schema-decoding behaviour.
3. **Tier 3**: nothing — Tier 3 is a contract-drift safety net, not a
   per-tool concern.

---

## References

- `repos/pi/packages/ai/src/providers/faux.ts` — pi's faux LLM, same
  intent as our `withLanguageModel`.
- `repos/pi/packages/ai/test/anthropic-opus-4-7-smoke.test.ts` — pi's
  Tier 3 pattern; env-gated, skipped in CI.
- `repos/codex/codex-rs/app-server/tests/common/mock_model_server.rs` —
  codex's WireMock-based scripted responses. Same idea, different
  language.
- `repos/effect/packages/ai/ai/test/utilities.ts` — the canonical
  `withLanguageModel` we mirror line-for-line.
- `repos/effect/packages/ai/ai/test/LanguageModel.test.ts`,
  `Tool.test.ts`, `Chat.test.ts` — Effect's own Tier 2 tests; read these
  before inventing a new test pattern.
- `repos/effect/packages/vitest/README.md` — `it.effect` / `it.live` /
  `it.scoped` reference. Useful when the test you want to write doesn't
  fit one of the patterns above.
