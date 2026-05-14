# Agent Loop

## Goal

A single user prompt drives the model across as many sampling rounds as
needed — the harness keeps re-invoking the model while it requests tool
calls, until the model produces a final answer (or a step cap is hit), so
the assistant actually uses tool results in its reply instead of stopping
after the first tool-call round.

## Requirements

- A new helper `runAgentTurn({ chat, prompt, stopWhen? })` lives in
  `packages/harness/src/agent-loop.ts` and returns a `Stream<TurnEvent, never>`
  (errors are surfaced as `{ kind: "error" }` events, not stream failures).
- The helper repeatedly invokes `chat.streamText({ prompt, toolkit: HarnessToolkit })`,
  emitting every model event (`text-delta`, `tool-call`, `tool-result`,
  `finish`, `error`) downstream as it arrives. After each round's `finish`,
  if the finish reason is `"tool-calls"` and `stopWhen` returns false, it
  recurses into a fresh round with an empty user prompt (`Chat.streamText`
  already threads the prior round's tool results into history).
- `stopWhen` is a caller-provided predicate `(state: { step: number }) => boolean`.
  A `stepCountIs(n)` factory in the same file returns the canonical predicate
  used by call sites; default at call sites is `stepCountIs(25)`.
- Across multiple internal rounds the helper emits a continuous, transparent
  event stream — no `step-start` / `step-finish` boundary events. Callers
  see one logical turn.
- `runChatTurn` (`packages/tui/src/chat.ts:145`) becomes a thin adapter that
  consumes `runAgentTurn(...)` via `Stream.runForEach(onEvent)`; existing
  TUI behaviour (transcript updates, status, approvals) is unchanged.
- `runCommand` (`packages/cli/src/cli.ts:64`) builds a fresh `Chat.empty`
  per invocation, consumes `runAgentTurn(...)` live — printing each
  `tool-call` / `tool-result` / streamed `text-delta` line as it arrives —
  then prints the existing final summary block (`text:`, `tool calls (N):`,
  `tool results (N):`, `plan`, `finish:`) once the stream completes.
- When the model finishes with `finishReason` other than `"tool-calls"`
  (e.g. `"stop"`, `"length"`, `"pause"`, `"error"`), the loop stops after
  emitting that round's events.
- When `stopWhen` returns true while `finishReason === "tool-calls"`, the
  loop stops and emits a single trailing `{ kind: "error", message: ... }`
  event noting the cap was hit. The chat session / CLI does not crash.
- A stream error inside any round becomes one `{ kind: "error" }` event;
  the helper does not recurse after an error.

## Implementation hints

- Mirror the recursive-stream shape of
  `/Users/alexanderopalic/Projects/effectclanker/repos/opencode/packages/llm/src/tool-runtime.ts:64-148`
  — a local `loop(step)` returns `Stream.unwrap(Effect.gen(...))` that
  concatenates the model stream with a conditional continuation stream.
- `Chat.streamText` already threads history per round — see
  `/Users/alexanderopalic/Projects/effectclanker/repos/effect/packages/ai/ai/src/Chat.ts:381-411`
  (the `acquireUseRelease` writes `Prompt.fromResponseParts(parts)` back into
  the history `Ref` after the stream finishes). The recursive call inside
  the loop should pass an empty prompt so it doesn't append a phantom user
  turn.
- `FinishReason` is the canonical union — `"tool-calls"` is the
  continue-signal. Anthropic's `tool_use` → `"tool-calls"` mapping is at
  `/Users/alexanderopalic/Projects/effectclanker/repos/effect/packages/ai/anthropic/src/internal/utilities.ts:4-11`.
  Don't string-compare on `"tool_use"` — key off the normalised value.
- Move the `TurnEvent` union from `packages/tui/src/chat.ts:9-25` into
  `packages/harness/src/agent-loop.ts` and re-import it in `chat.ts`. The
  `cli → tui → harness → tools` layering forbids harness importing from
  tui (`CLAUDE.md` "Code architecture").
- Move `partToEvent` (`packages/tui/src/chat.ts:51-100`) into the same
  harness file — it's the response-part-to-`TurnEvent` mapper and belongs
  next to the helper, not the TUI.
- This change closes the gap documented in
  `docs/patterns/effect-ai-gotchas.md` §3 ("`generateText` is a single
  round-trip, not the agent loop"). Update that gotcha after the loop is
  shipped — point at `agent-loop.ts` as the resolution.
- Don't add a `--max-steps` CLI flag; both call sites hardcode
  `stepCountIs(25)`.
- For the toolkit-via-mock test (`runToolkit` in
  `packages/harness/test/utilities.ts:123`), the existing two-explicit-call
  "loop continues after a failed tool call" assertion stays as-is — it
  documents `generateText`'s single-round semantics directly. New
  multi-round assertions live in the new test file.

## Acceptance criteria

TDD order — write the first test, watch it fail, then make it pass. Then the next.

- [ ] **Red:** `packages/harness/test/agent-loop.test.ts` →
      `it.effect("continues until finishReason is not tool-calls", ...)` exists
      and fails because `runAgentTurn` is not yet exported. The mock's `streamText`
      branches on a call counter: call 1 emits `tool-call("glob", ...)` +
      `finish("tool-calls")`; call 2 emits `text-delta("done") + finish("stop")`.
      Asserts `call === 2` AND the collected `TurnEvent`s contain a `text-delta`
      whose joined deltas include `"done"`.
- [ ] **Green:** the same test passes after a minimal `runAgentTurn` that
      recurses while `finishReason === "tool-calls"`.
- [ ] `packages/harness/test/agent-loop.test.ts` →
      `it.effect("stops at stepCountIs(2) even when model still requests tools", ...)`
      — mock always emits `tool-call` + `finish("tool-calls")`; asserts call
      count is exactly 2, and the event sequence ends with one
      `{ kind: "error", message: <mentions cap> }`.
- [ ] `packages/harness/test/agent-loop.test.ts` →
      `it.effect("surfaces stream errors as an error event, not a thrown failure", ...)`
      — mock returns `Stream.fail(new AiError.MalformedOutput(...))`; asserts the
      collected events end with one `{ kind: "error" }` and the helper's Effect
      succeeds.
- [ ] `packages/harness/test/agent-loop.test.ts` →
      `it.effect("stops on finishReason \"pause\" without recursing", ...)` —
      mock emits a tool-call round that finishes with `"pause"`; asserts call
      count is 1 and no further events appear after that round's `finish`.
- [ ] `packages/tui/test/chat.test.ts` →
      `it.effect("single runChatTurn loops across multiple model rounds", ...)`
      — mock branches on call counter as in the red test; asserts a _single_
      `runChatTurn` invocation produces events from both rounds (the prior
      "preserves prior turn's tool result across two turns" test \[chat.test.ts:49\]
      stays, validates the two-`runChatTurn` history-threading path separately).
- [ ] `packages/harness/test/toolkit.test.ts` — existing
      "loop continues after a failed tool call" (line 63) keeps passing
      unchanged. `runToolkit` still calls raw `generateText`, so it documents
      single-round semantics; the new loop only kicks in via `runAgentTurn`.
- [ ] No `setTimeout`, no real LLM calls, no flaky waits — per `CLAUDE.md`.
- [ ] `bun run check` passes (typecheck, lint, format, tests).

## Out of scope

- Auto-compaction or token-limit handling. Codex compacts inside its loop
  (`repos/codex/codex-rs/core/src/session/turn.rs:494`); we just stop at
  `stepCountIs(25)`.
- Per-round approval semantics. Approval is already per-tool-call inside a
  round; the loop adds rounds, not new approval points. Existing
  `ApprovalPolicy` plumbing continues to work without changes.
- A `--max-steps` CLI flag. Hardcode `stepCountIs(25)`; revisit if needed.
- Mid-loop pause/resume UI. The loop stops cleanly on `finishReason === "pause"`
  but there's no UX to resume from there yet.
