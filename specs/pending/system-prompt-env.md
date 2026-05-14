# System-Prompt Environment Context

## Goal

Seed every CLI and chat session with a single system message describing the
process's environment (working directory, OS platform, today's date) so the
model has actionable context from turn 0 instead of starting blind.

## Requirements

- A new pure builder `buildEnvironmentSystemPrompt(env)` in
  `/Users/alexanderopalic/Projects/effectclanker/packages/harness/src/system-prompt.ts`
  takes `{ cwd: string; platform: string; date: Date }` and returns a single
  string of the form:

  ```
  Here is some useful information about the environment you are running in:
  <env>
    Working directory: <cwd>
    Platform: <platform>
    Today's date: <date.toDateString()>
  </env>
  ```

  No model id, no git-repo flag, no extra fields — three labeled lines inside
  the `<env>` block, in that order.

- A companion helper `chatWithEnvironment(env)` in the same file returns
  `Effect.Effect<Chat.Service, never, LanguageModel.LanguageModel>` by calling
  `Chat.fromPrompt([{ role: "system", content: buildEnvironmentSystemPrompt(env) }])`.
  Same `env` input shape as the builder.

- Both names re-exported from
  `/Users/alexanderopalic/Projects/effectclanker/packages/harness/src/index.ts`.

- `runCommand` in `/Users/alexanderopalic/Projects/effectclanker/packages/cli/src/cli.ts:79`
  swaps `yield* Chat.empty` for
  `yield* chatWithEnvironment({ cwd: process.cwd(), platform: process.platform, date: new Date() })`.

- `runChatApp` in `/Users/alexanderopalic/Projects/effectclanker/packages/tui/src/chat-runtime.tsx:21`
  makes the same swap and captures the same env value in a `const seedPrompt`
  it can hand to `/clear`.

- `slashCommand` in `/Users/alexanderopalic/Projects/effectclanker/packages/tui/src/chat.ts:29`
  gains an optional third parameter
  `clearTo: Prompt.RawInput = Prompt.empty`. On `/clear` it sets
  `chat.history` to `Prompt.make(clearTo)` (not `Prompt.empty`). Runtime sites
  pass the env-seeded prompt so clearing preserves the env context.

- Existing test sites that call `slashCommand(line, chat)` keep working —
  the new third argument defaults to `Prompt.empty`, which matches today's
  behaviour exactly.

- The mock-LLM-side observable: after seeding a Chat via `chatWithEnvironment`
  and running one turn, the prompt passed to `streamText` has a `role:"system"`
  message as its first entry, whose text contains the cwd, the platform,
  and the date string.

## Implementation hints

- Builder is a one-liner template literal — no Effect machinery, no I/O.
  Call sites read `process.cwd()` / `process.platform` / `new Date()` and
  thread them in so the builder stays deterministic and trivially testable.

- `Chat.fromPrompt` is the only natural seam — see
  `/Users/alexanderopalic/Projects/effectclanker/repos/effect/packages/ai/ai/src/Chat.ts:493-499`.
  It writes the provided `RawInput` into the same history `Ref` that
  `Chat.empty` initialises to `Prompt.empty`, so downstream `streamText`
  and the `acquireUseRelease` history threading at `Chat.ts:381-411`
  continue to work without changes.

- Reference shape for the `<env>` block lives at
  `/Users/alexanderopalic/Projects/effectclanker/repos/opencode/packages/opencode/src/session/system.ts:48-63`.
  Trim it: keep only cwd, platform, date. Skip `model.api.id`, `worktree`,
  `vcs === "git"` per spec scope.

- Sibling source for testable pure helpers: any tool's handler in
  `/Users/alexanderopalic/Projects/effectclanker/packages/tools/src/` — they're
  all "input in → result out" the same way.

- Sibling test for handler-direct shape: any file under
  `/Users/alexanderopalic/Projects/effectclanker/packages/tools/test/` for the
  `it.effect` + `expect(...)` shape. No `withTmpDir` is needed — this builder
  doesn't touch the filesystem.

- The mock-prompt-capture test for the system message uses `withLanguageModel`
  from `/Users/alexanderopalic/Projects/effectclanker/packages/harness/test/utilities.ts`.
  Pass `streamText: (opts) => { ... }` and capture `opts.prompt` into a closure
  variable (an `Array<Prompt.Message>` ref or local), then assert after the
  turn. This is the same pattern the existing `agent-loop.test.ts` uses
  (`call` counter via closure).

- `Prompt.make` builds a `Prompt` from a `RawInput` — see
  `/Users/alexanderopalic/Projects/effectclanker/repos/effect/packages/ai/ai/src/Prompt.ts:1486`.
  For `/clear`, `Ref.set(chat.history, Prompt.make(clearTo))` is the equivalent
  of today's `Ref.set(chat.history, Prompt.empty)` when `clearTo` defaults to
  `Prompt.empty`.

- Don't add an `EnvContext` `Context.Tag` or a Layer. Threading three values
  through two call sites is cheaper than introducing a service. (Reconsider
  if a third call site shows up.)

- This is the kind of small, broadly-useful upgrade that should also be
  cross-referenced from `/Users/alexanderopalic/Projects/effectclanker/docs/patterns/effect-ai-gotchas.md`
  alongside the existing §3 / §4 entries — note that `Chat.fromPrompt` with a
  `role:"system"` message is how you seed env context, since `Chat.empty`
  starts blind. Add this docs entry as part of the change.

## Acceptance criteria

TDD order — write the first test, watch it fail, then make it pass. Then the next.

- [ ] **Red:** `packages/harness/test/system-prompt.test.ts` →
      `it.effect("builds an env block containing cwd, platform, and date", ...)`
      exists and fails because `buildEnvironmentSystemPrompt` is not exported
      yet. Calls the builder with
      `{ cwd: "/tmp/work", platform: "darwin", date: new Date("2026-05-14T00:00:00Z") }`
      and asserts the returned string contains `<env>`, `</env>`,
      `Working directory: /tmp/work`, `Platform: darwin`, and
      `Today's date: ` followed by the same `new Date("2026-05-14T00:00:00Z").toDateString()`
      value (do not hard-code the formatted string — derive it the same way
      in the test, so timezones don't make the test flaky).
- [ ] **Green:** the same test passes after the minimal pure builder is
      implemented and exported from `packages/harness/src/index.ts`.
- [ ] `packages/harness/test/system-prompt.test.ts` →
      `it.effect("orders env lines: cwd, platform, date", ...)` — asserts the
      three label substrings appear in that order via index comparison.
- [ ] `packages/harness/test/system-prompt.test.ts` →
      `it.effect("chatWithEnvironment seeds history with one system message", ...)`
      — calls `chatWithEnvironment({...})` under `withLanguageModel({})`,
      reads `chat.history` via `Ref.get`, asserts there is exactly one message,
      `role === "system"`, and its content text equals
      `buildEnvironmentSystemPrompt({...})` from the same env.
- [ ] `packages/tui/test/chat.test.ts` →
      `it.effect("the mock LLM sees the env system message on the first turn", ...)`
      — captures `opts.prompt` from `withLanguageModel({ streamText: (opts) => { ...record... } })`,
      runs one `runChatTurn({ chat: yield* chatWithEnvironment({...}), prompt: "hi", onEvent })`
      where the mock emits `finishPart("stop")`, then asserts the recorded
      prompt's first message is `role:"system"` whose text contains
      `/tmp/work`, `darwin`, and the expected date string.
- [ ] `packages/tui/test/chat.test.ts` →
      `it.effect("/clear with a seed prompt preserves the system message", ...)`
      — seeds chat with `chatWithEnvironment({...})`, runs `slashCommand("/clear", chat, [{role:"system", content: "X"}])`,
      reads `chat.history`, asserts it has exactly one message with
      `role === "system"` and content `"X"`. A second sub-assertion runs
      `slashCommand("/clear", chat)` (no third arg) and asserts history is
      `Prompt.empty` — proves the default keeps today's behaviour.
- [ ] Existing tests under `packages/harness/test/` and `packages/tui/test/`
      that build `Chat.empty` directly stay untouched and keep passing — they
      document the empty-history baseline; only production call sites move to
      the seeded path.
- [ ] `packages/cli/src/cli.ts:79` and `packages/tui/src/chat-runtime.tsx:21`
      both call `chatWithEnvironment` instead of `Chat.empty`. (Smoke check by
      reading the diff — no automated CLI/TUI integration test required.)
- [ ] `docs/patterns/effect-ai-gotchas.md` gains a short subsection (or §6)
      pointing at `chatWithEnvironment` as the seeding pattern; one paragraph,
      one link to `packages/harness/src/system-prompt.ts`.
- [ ] No `setTimeout`, no real LLM calls, no flaky waits — per `CLAUDE.md`.
- [ ] `bun run check` passes (typecheck, lint, format, tests).

## Out of scope

- Model id in the env block. The user explicitly named cwd/OS/date; adding
  more risks duplicating data the model already knows (its own id) or
  paying a startup cost (`fs.exists('.git')`).
- Git-repo flag, workspace root folder, skill listings. Opencode does these;
  we don't yet. Revisit when a real prompt needs them.
- Provider-specific system prompts (`anthropic.txt`, `gpt.txt`, etc. from
  `repos/opencode/packages/opencode/src/session/prompt/`). One env block,
  one provider — keep the surface small.
- `EnvContext` as a tagged service / Layer. Two call sites doesn't justify it.
- Re-seeding env context mid-session if `process.cwd()` changes. Built once
  per process; if the user `cd`s inside a shell tool, the model's view is
  stale until the next run. Acceptable.
- A `--no-system-prompt` CLI flag. If we need it, add it then.
