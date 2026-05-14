# Interactive Chat

## Goal

Running `bun src/cli.ts` with no arguments drops the user into an interactive
multi-turn coding-agent session — type a prompt, see the assistant's text
stream in live, watch tool calls execute, type the next prompt, conversation
state is preserved.

## Requirements

- `bun src/cli.ts` (no subcommand) launches an Ink-rendered chat UI; the
  existing `bun src/cli.ts run "<prompt>"` one-shot path continues to work
  unchanged.
- The chat UI is laid out as: scrolling transcript on top, single-line
  composer (`>` prompt) on bottom, status line in between (current model,
  approval mode).
- Each user turn appends a user bubble to the transcript, then streams an
  assistant bubble whose text grows character-by-character as `streamText`
  deltas arrive.
- Conversation history persists across turns: turn N's prompt sent to the
  model contains every prior user message, assistant response, and tool
  result from turns 1..N-1.
- Tool calls during a turn render as collapsed lines in the transcript
  (`▶ bash {"command":"ls"}`) followed by their result or failure.
- Slash commands recognised: `/exit` quits cleanly, `/clear` resets the
  conversation history (fresh `Chat.empty`), `/help` lists the three
  commands. Unknown `/foo` is sent to the model verbatim.
- Gated tool calls (bash, write, edit, apply_patch) under
  `--approval interactive` surface as an inline modal in the transcript;
  the user picks `[y]/[N]` and the tool resumes with the answer. With
  `--approval auto` (default) and `--approval deny` the chat behaves as
  the existing flags dictate, with no modal.
- The `update_plan` tool's effect (the `PlanStore` contents) renders in
  the status line after each turn it changes.
- Errors from `LanguageModel.streamText` (network, schema decoding,
  `MalformedOutput`) display as a red error bubble in the transcript;
  the session stays alive and the composer re-enables for the next prompt.
- Ctrl-C during an in-flight turn cancels that turn (the streaming Effect
  is interrupted) and returns the composer to ready; Ctrl-C with the
  composer empty quits.

## Implementation hints

- Sibling source for tool-spec + handler shape: `/Users/alexanderopalic/Projects/effectclanker/src/tools/bash.ts`.
- Sibling source for service + Layer shape: `/Users/alexanderopalic/Projects/effectclanker/src/services/approval-policy.ts` — the new `ApprovalInkLayer` is a fourth case alongside the existing three.
- Sibling source for service + Layer shape: `/Users/alexanderopalic/Projects/effectclanker/src/services/plan-store.ts` — same `Context.Tag` + `Layer.effect` shape.
- CLI wiring: `/Users/alexanderopalic/Projects/effectclanker/src/cli.ts` — add a `chatCommand` and use `@effect/cli`'s `Command.withSubcommands` default-routing so bare `bun src/cli.ts` runs it. Keep `runCommand` untouched.
- State backbone: `Chat.empty` from `@effect/ai` — see `/Users/alexanderopalic/Projects/effectclanker/repos/effect/packages/ai/ai/src/Chat.ts:327` for the constructor and `:241-248` for `streamText`'s `Stream.Stream<Response.StreamPart, …>` signature. The internal `semaphore.withPermits(1)` already serialises concurrent calls — do not add your own lock.
- Stream parts to handle in the renderer (literal types from `repos/effect/packages/ai/ai/src/Response.ts`): `text-delta` (append to current assistant bubble), `tool-call` (start a tool line), `tool-result` (close it), `finish` (turn done), `error` (render as error bubble).
- Approval bridge: `ApprovalInkLayer` exposes a `Queue<ApprovalRequest>` (or `Mailbox`) the UI subscribes to; `requireApproval` enqueues a request together with a `Deferred<boolean>`, then awaits the `Deferred`. The UI listens, renders a modal, calls `Deferred.succeed(true|false)` on the user's choice. Existing `ApprovalDenied` tagged error stays the failure path.
- Effect ↔ Ink bridge: render the Ink app inside an `Effect.acquireUseRelease` that owns the rendered instance (`render(...).waitUntilExit()` on use, `unmount()` on release). User input from the composer pushes onto a `Queue<string>` the chat-loop Effect pulls from; the loop fires `Chat.streamText` per pulled line.
- `streamText` returns a `Stream` — consume into the Ink state via `Stream.runForEach` inside an `Effect.fork`ed fiber so cancellation is one `Fiber.interrupt` away (Ctrl-C).
- Reuse `HarnessToolkitLayerBare` and the existing approval-layer factory in `src/cli.ts`. The `chat` command stacks: chat-app layer → `HarnessToolkitLayerBare` → `ApprovalInkLayer` (new) → `PlanStoreLayer` → `AnthropicLanguageModel.layer` → `AnthropicClientLive` (provided last so `--help` still doesn't need the API key — see [`docs/patterns/effect-ai-gotchas.md`](../../docs/patterns/effect-ai-gotchas.md) §2).
- Every fallible tool already has `failureMode: "return"`; the chat loop never sees a tool failure on the Effect error channel — it sees a `tool-result` with `isFailure: true`. See [`docs/patterns/effect-ai-gotchas.md`](../../docs/patterns/effect-ai-gotchas.md) §1.
- `withLanguageModel` in `test/utilities.ts` already supports scripted `streamText` (line 64-73) — use it; do not add a new helper.
- Do NOT design persistence, compaction, or allowlist approval into the schema. Out of scope per backlog Epics 2/4/5.
- Add `ink` and `react` (and `@types/react`) to `dependencies`. Do not add `ink-testing-library` — UI is verified manually for v1.

## Acceptance criteria

TDD order — write the first test, watch it fail, then make it pass. Then the next.

- [ ] **Red:** `test/chat.test.ts` › `it.effect("preserves prior turn's tool result across two turns")` exists and fails because `Chat.streamText` (driven through `withLanguageModel({ streamText: scriptedFn })` and `HarnessToolkitLayer`) is not yet wired into a chat-loop module — the `runChatTurn` helper the test imports does not yet exist.
- [ ] **Green:** the same test passes — turn 1's scripted parts include a `tool-call` for `read` plus a final `text` part; turn 2's scripted-parts function asserts on `opts.prompt` that the prior assistant text and tool result are present, then emits a different final `text`. Use `Chat.empty` and call `chat.streamText` twice via `Stream.runDrain`.
- [ ] `it.effect("/clear resets Chat history")` — build a Chat, call `streamText` once, run the `slashCommand("/clear", chat)` handler, assert `Ref.get(chat.history)` returns `Prompt.empty`.
- [ ] `it.effect("/help returns the three command names")` — `slashCommand("/help", chat)` returns text containing `/exit`, `/clear`, `/help`.
- [ ] `it.effect("unknown /foo is forwarded to the model as-is")` — `slashCommand("/foo bar", chat)` returns the sentinel `{ kind: "passthrough", text: "/foo bar" }`.
- [ ] `it.effect("/exit returns a quit signal")` — asserts the result is `{ kind: "quit" }`; the chat loop reacts to this by interrupting its input fiber.
- [ ] `it.effect("ApprovalInkLayer enqueues a request and resolves on Deferred.succeed(true)")` — provide the layer, call `requireApproval({ kind: "bash", command: "ls" })` in a forked fiber, take the request off the queue, complete its Deferred with `true`, assert the forked Effect succeeds with `void`.
- [ ] `it.effect("ApprovalInkLayer fails with ApprovalDenied on Deferred.succeed(false)")` — same shape; assert via `expectLeft(result, "ApprovalDenied")` that the forked Effect fails with the tagged error.
- [ ] `it.effect("streamText error surfaces as a chat error event, not a thrown failure")` — script `streamText` to fail with `AiError`; assert the chat-loop Effect succeeds (does NOT propagate the failure) and that the rendered transcript state contains an error entry. Mirrors the loop-stays-alive guarantee.
- [ ] `bun run check` passes (typecheck, lint, format, tests).
- [ ] No `setTimeout`, no real LLM calls, no flaky waits — per `CLAUDE.md`. The test that exercises the streaming Stream uses `Stream.runDrain` / `Effect.either`, not a wall-clock wait.
- [ ] Manual verification: `bun src/cli.ts` launches the Ink UI; typing a prompt streams a response; `/clear` empties the transcript; `/exit` quits; Ctrl-C during streaming cancels and returns to the composer.
