# `@effect/ai` gotchas

Three patterns this project ran into during its first migration to
`@effect/ai`. Each cost real debugging time; each fix is non-obvious from the
public package docs. Plus a short tooling appendix at the bottom for things
that are easy to discover once you know they exist.

---

## 1. Set `failureMode: "return"` on every fallible tool

**Symptom.** A test (or a real model run) calls a tool with bad input. Instead
of seeing the failure surface as a structured tool result the model can react
to, the entire `LanguageModel.generateText` call rejects with the raw error
string. Your turn dies. The model never gets a chance to recover.

```
Error: read failed: Error: ENOENT: no such file or directory, open '/no/such/path/xyz'
```

**Fix.** Add `failureMode: "return"` to the tool spec.

```ts
export const EditTool = Tool.make("edit", {
  description: "...",
  parameters: { path: Schema.String, oldString: Schema.String, newString: Schema.String },
  success: Schema.Struct({ replaced: Schema.Number }),
  failure: Schema.String,
  failureMode: "return", // <- this
});
```

**Why.** `Tool.make` defaults `failureMode` to `"error"`. In that mode, a
handler's `Effect.fail(failure)` propagates as a true Effect failure, which
escapes through `generateText` and kills the turn. With `"return"`, the
framework catches the failure and encodes it into a `Response.toolResultPart`
with `isFailure: true` on the returned `GenerateTextResponse` — the failure
is now data the caller can hand back to the model on a subsequent turn
(see gotcha §3 — `generateText` does not feed it back on its own). The
point is that a single bad tool call must not abort the conversation; it
should be recoverable on the next turn. Codex enforces the same invariant
in `repos/codex/codex-rs/core/src/session/turn.rs` (`drain_in_flight`).

Set `"return"` on **every** tool that has a non-`Never` failure schema. The
two are coupled: declaring a failure schema and leaving `failureMode` at
`"error"` is almost always a mistake.

See: `src/tools/*.ts` for the canonical shape; `test/toolkit.test.ts` →
"surfaces handler failures as tool result failures, not thrown errors" for
the assertion.

---

## 2. Scope credential-requiring layers to the handler, not `MainLive`

**Symptom.** Running `bun src/cli.ts --help` (no API key in env) prints:

```
[…] ERROR (#17):
  Error: (Missing data at ANTHROPIC_API_KEY: "Expected ANTHROPIC_API_KEY to exist in the process context")
```

Help should not require credentials. Neither should listing subcommands,
running validation, or any read-only operation.

**Fix.** Don't put credential-reading layers in the top-level
`Layer.mergeAll(...)`. Put them inside the specific command handler that
actually needs them.

```ts
// src/cli.ts — wrong:
// const MainLive = Layer.mergeAll(AnthropicClientLive, HarnessToolkitLayer, NodeContext.layer);

// right:
const runCommand = Command.make("run", {...}, ({ model, prompt }) =>
  Effect.gen(function*() { /* uses LanguageModel */ }).pipe(
    Effect.provide(AnthropicLanguageModel.layer({ model })),
    Effect.provide(AnthropicClientLive),   // <- scoped here, not in MainLive
  ),
);

const MainLive = Layer.mergeAll(HarnessToolkitLayer, NodeContext.layer);
```

**Why.** `AnthropicClient.layerConfig({ apiKey: Config.redacted(...) })` is
built via `Config.all(configs).pipe(Effect.flatMap(make))` — the Config
values are read when the layer materialises. When that layer sits in
`MainLive`, providing `MainLive` to the whole CLI effect causes it to
materialise before `@effect/cli` decides which subcommand to run, including
`--help`.

The principle generalises: **a Layer that fails on missing config is a Layer
that should be provided as close to its first use as possible.** Putting it
at `MainLive` makes the failure mode global; putting it inside the handler
keeps it local to the code that genuinely needs it.

See: `src/cli.ts` — `AnthropicClientLive` is provided inside `runCommand`,
not in `MainLive`.

---

## 3. `generateText` is a single round-trip, not the agent loop

**Symptom.** Two related confusions land here:

- (a) You assume `generateText` only does one model call and start writing
  your own loop with message threading, max-turn guards, the works.
- (b) You assume `generateText` runs _the whole_ agent loop and call it
  once, then can't figure out why your "multi-turn agent" only ever does
  one turn against Anthropic.

Both are wrong. The truth is in between.

**Fix.** Use `generateText` for what it actually is — one model call plus
intra-call tool dispatch — and drive multi-turn looping yourself (or use
`Chat`, which keeps the history `Ref` for you).

```ts
// One round-trip. Model emits text + tool-calls; framework dispatches the
// tool-calls through the registered handlers; you get back a single
// aggregated response.
const response =
  yield *
  LanguageModel.generateText({
    prompt,
    toolkit: HarnessToolkit,
  });

// For a true agent loop you call generateText repeatedly, appending the
// prior response's parts to the prompt each time. `Chat` does this.
```

**Why.** Source: `repos/effect/packages/ai/ai/src/LanguageModel.ts:785` is
the only call to the provider's `generateText` in the path —
`generateContent` invokes it once, dispatches tool calls via
`resolveToolCalls` (line 788, parallel-`Effect.forEach` over the tool-call
parts), and returns. There is no `while`-loop, no max-iteration guard, no
re-invocation of the model after tool dispatch.

What `generateText` **does** handle for you:

- Calling the provider once with the right prompt + tools.
- Dispatching every tool call in the response through `toolkit.toLayer({...})`.
- Encoding each handler outcome (success or `failureMode: "return"` failure)
  into a `ToolResultPart` on the response.
- Aggregating model parts + tool results into a single
  `GenerateTextResponse`.

What it **doesn't** handle: feeding tool results back to the model. If
turn 1's tool result needs to inform turn 2's behaviour, you have to
issue a second `generateText` call with an updated prompt.

You can verify the single-turn semantic against
`test/toolkit.test.ts` → "loop continues after a failed tool call" — the
mock's call counter equals exactly the number of explicit `generateText`
invocations from the test body.

See also: `repos/effect/packages/ai/ai/src/Chat.ts` — `Chat.send` is the
higher-level primitive that maintains history (`Ref.Ref<Prompt.Prompt>`)
and re-invokes `generateText` per call, but it still doesn't loop on
its own. If you want true multi-turn-until-stop, that's caller-driven.

How the reference harnesses do the outer loop:

- `repos/codex/codex-rs/core/src/session/turn.rs:384` — `loop { run_sampling_request(...); if needs_follow_up { continue } else { break } }`. Doc-comment at line 121 spells out the contract.
- `repos/opencode/packages/llm/src/tool-runtime.ts:76` — recursive `loop(request, step, ...)` that re-invokes the model while `finishReason === "tool-calls"`.

Both: keep calling the model until `finishReason` is something other than `"tool-calls"`.

**Status: resolved.** The outer loop lives in `packages/harness/src/agent-loop.ts` (`runAgentTurn` + `stepCountIs`). Both call sites — `packages/tui/src/chat.ts:runChatTurn` (chat mode) and `packages/cli/src/cli.ts:runCommand` (one-shot `run` mode) — drive it with `stepCountIs(25)`. The helper returns `Stream<TurnEvent, never>`; errors surface as trailing `{ kind: "error" }` events rather than stream failures. See `packages/harness/test/agent-loop.test.ts` for the four-case contract (continue, cap, stream-error, `pause`).

---

## 4. Two non-obvious traps when looping `Chat.streamText`

If you're writing an outer loop around `Chat.streamText` (or extending
`runAgentTurn`), these two cost real time:

**A. `Prompt.make("")` adds a phantom user turn; `Prompt.empty` does not.**

The recursive call in an agent loop should pass an empty prompt so the
provider sees `[…, assistant, tool_result]` and not
`[…, assistant, tool_result, user("")]`. But `Prompt.make("")` builds a
real user message with empty text, because `Prompt.make` branches on the
input shape:

```ts
// repos/effect/packages/ai/ai/src/Prompt.ts:1486
export const make = (input: RawInput): Prompt => {
  if (Predicate.isString(input)) {
    const part = makePart("text", { text: input });
    const message = makeMessage("user", { content: [part] });
    return makePrompt([message]); // <- one user message, even if text is ""
  }
  if (Predicate.isIterable(input)) {
    return makePrompt(decodeMessagesSync(Arr.fromIterable(input), { errors: "all" }));
  }
  return input;
};
```

So pass `Prompt.empty` (or `[]`) to the recursive call. `runAgentTurn`
does this at `packages/harness/src/agent-loop.ts:runAgentTurn` — see the
`step === 0 ? prompt : Prompt.empty` line.

**B. `tool-result` parts arrive AFTER the `finish` part on the stream.**

`Chat.streamText` (and `LanguageModel.streamText`) emits the provider's
`finish` event when the **model** is done generating. The toolkit then
dispatches tool calls and emits their `tool-result` parts onto the same
stream — which means a stream's part order is, in general:

```
text-delta… tool-call… finish  tool-result… (end of stream)
```

Don't assert "nothing comes after finish" in tests, and don't gate
post-finish handling on the stream being exhausted before tool results
arrive. Track the finish reason via `Stream.tap` and run any
"should-I-recurse" logic in a continuation stream concatenated after the
model stream, not in the `finish` handler itself. `runAgentTurn` reads
`finishRef` only inside the continuation's `Stream.unwrap`.

---

## 5. Anthropic reserves a handful of tool names

**Symptom.** A `generateText` (or `streamText`) call rejects with a schema
decode error like:

```
ToolCallPart
  └─ ["name"]
     └─ Expected "read" | "write" | "edit" | … | "bash" | …, actual "AnthropicBash"
```

You registered a tool called `bash` and the model called `bash`, but the
response part comes back named `"AnthropicBash"` and fails to decode against
your toolkit's tool-name union.

**Fix.** Rename the tool. Anthropic reserves these names for its
provider-defined (server-side) tools — don't use any of them for a custom
tool:

```
bash, code_execution, computer, str_replace_based_edit_tool,
str_replace_editor, web_search
```

We hit this exact bug, which is why our shell tool is registered as `shell`
(`packages/tools/src/shell.ts`), not `bash`. Codex makes the same choice.
A structural guard test in `packages/harness/test/reserved-tool-names.test.ts`
asserts `HarnessToolkit`'s tool names are disjoint from the reserved set, so
re-introducing a collision fails CI rather than the next live stream.

**Why.** `repos/effect/packages/ai/anthropic/src/AnthropicTool.ts:529` —
the Anthropic adapter holds a `ProviderToolNamesMap` that unconditionally
rewrites incoming tool-call names matching this set to the corresponding
provider-defined toolkit name (`bash` → `AnthropicBash`,
`web_search` → `AnthropicWebSearch`, etc.). The rewrite happens before
the response schema decodes the parts, so a custom tool with the same
name never gets a chance to match.

The adapter doesn't check whether the user actually registered a
provider-defined tool; the rewrite is name-based and global. So even
when our tool was `Tool.make("bash", …)` against our own handler, any
call the model labelled `"bash"` got interpreted as targeting
`Bash_20241022` / `Bash_20250124` and decoding blew up against our
narrower union.

See: `repos/effect/packages/ai/anthropic/src/AnthropicTool.ts:529` for the
map; lines 47 and 70 for the provider-defined Bash tools that the rewrite
targets.

---

## 6. Seed env context with `Chat.fromPrompt`, not `Chat.empty`

`Chat.empty` initialises history to `Prompt.empty` — the model sees no
working directory, no platform, no date. That blank start is fine for
unit tests but wrong for any real session: the model has to ask the user
(or hallucinate) for context it could have had from turn 0.

The seam is `Chat.fromPrompt(rawInput)` at
`repos/effect/packages/ai/ai/src/Chat.ts:493-499`. It calls `Chat.empty`
internally and then `Ref.set`s the history to `Prompt.make(rawInput)`,
so downstream `streamText` / history threading in `Chat` work
unchanged. Pass a single `role: "system"` message describing the
environment.

In this repo: `packages/harness/src/system-prompt.ts` exposes
`buildEnvironmentSystemPrompt(env)` (pure, three-line `<env>` block) and
`chatWithEnvironment(env)` (thin wrapper over `Chat.fromPrompt`). Both
CLI (`packages/cli/src/cli.ts`) and TUI (`packages/tui/src/chat-runtime.tsx`)
seed every session with it. The TUI also threads the same seed into
`slashCommand`'s third `clearTo` arg so `/clear` resets the visible
transcript without losing the env context.

Don't rebuild the seed when you already have the `Chat`. `Prompt.RawInput`
is `string | Iterable<MessageEncoded> | Prompt`
(`repos/effect/packages/ai/ai/src/Prompt.ts:1424-1428`) — so
`yield* Ref.get(chat.history)` returns a `Prompt` you can pass straight
back into anything that takes a `RawInput` (e.g. `Prompt.make(clearTo)`
inside `/clear`). The TUI uses exactly this: it builds the chat via
`chatWithEnvironment`, reads the seed back from `chat.history`, and
threads it into `slashCommand`. No duplicate string-build, and no risk
of the seed and the restore drifting apart.

Keep the env block deterministic and small: cwd, platform, date.
Anything that requires I/O (e.g. `fs.exists('.git')`) pays a startup
cost on every invocation, and the model already knows facts it doesn't
need to be told (its own id).

---

## Tooling appendix

Smaller things that aren't worth a full pattern but will save five minutes
of head-scratching.

### `oxlint`'s `ignorePatterns` doesn't suppress nested-config discovery

`oxlint` walks up from each file to find the closest `.oxlintrc.json` — and
it discovers those configs **before** it consults the root config's
`ignorePatterns`. So a vendored subtree under `repos/` that ships its own
`.oxlintrc.json` (opencode does, for example) can crash the entire lint
run on a config-shape mismatch, even with `"ignorePatterns": ["repos/**"]`
set at the root.

The error reads like a config-schema bug, not an ignore bug:

```
Failed to parse oxlint configuration file.
  x The `options.typeAware` option is only supported in the root config,
    but it was found in /…/repos/opencode/.oxlintrc.json.
```

Fix: scope the `lint` script to our own tree so oxlint never sees the
vendored configs.

```json
// package.json
"lint": "oxlint packages",
```

Don't rely on `ignorePatterns` alone when you add a new `repos/` entry —
check whether the vendored repo ships its own `.oxlintrc.json` and, if so,
keep `oxlint` scoped to `packages/`.

### `oxfmt` does not read `.oxfmtignore`

The flag exists (`--ignore-path`), but by default `oxfmt` reads `.gitignore`
and `.prettierignore`. If you check `repos/` into the repo (we do, as a
git subtree of reference material), it won't be in `.gitignore` and `oxfmt`
will happily descend into 2,700 vendored files.

Put ignores in `.oxfmtrc.json`:

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "ignorePatterns": ["repos/**", "node_modules/**", "dist/**", "coverage/**"]
}
```

### `oxfmt` mangles `yield*` in markdown TS code blocks

In a fenced ` ```ts ` block inside a `.md` file, a bare `yield* foo` on a
line that also contains `=` (e.g. `const x = yield* foo(...)`) gets
rewritten to `yield * foo` — invalid JavaScript. oxfmt's markdown parser
treats the unpaired `*` as italic emphasis even inside a fenced code
block. `yield*` lines outside an `=` assignment are usually left alone.

Workaround: wrap the snippet inside an `Effect.gen(function* () { … })`.
That pairs the asterisks (the `function*` and `yield*` both have one),
which calms the parser. This is also more honest — you can only `yield*`
inside a generator, so the snippet was incomplete without it.

```ts
// Don't: bare `yield*` on assignment lines gets mangled.
const turn1 = yield* runToolkit({ ... });

// Do: wrap in Effect.gen so `function*` pairs with `yield*`.
it.effect("...", () =>
  Effect.gen(function* () {
    const turn1 = yield* runToolkit({ ... });
  }),
);
```

The real `.ts` test files are unaffected — they go through `tsc` and
`oxlint`, not the markdown formatter.

### `oxlint` flags `_tag` as a dangling underscore

`_tag` is the Effect idiom for tagged-union discriminants (`Data.TaggedError`,
`Either`, `Option`). Oxlint's `no-underscore-dangle` rule (eslint-compat)
warns on every access. Allow it explicitly:

```json
{
  "rules": {
    "no-underscore-dangle": ["warn", { "allow": ["_tag", "_op"] }]
  }
}
```

`_op` is the same idea for some lower-level Effect internals.

### `@effect/ai`'s test mock isn't a public export

The canonical pattern for mocking `LanguageModel` in tests lives in
`repos/effect/packages/ai/ai/test/utilities.ts` as `withLanguageModel(...)`.
It's not exported from the package. We mirror it in `test/utilities.ts` so
test bodies stay clean. If you upgrade `@effect/ai`, glance at the upstream
file to see if the mock shape changed.
