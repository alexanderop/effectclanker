import { Prompt, type Chat } from "@effect/ai";
import type * as Response from "@effect/ai/Response";
import { Effect, Ref, Stream } from "effect";
import { HarnessToolkit } from "./toolkit.ts";

// Events emitted while consuming an agent turn's `Stream<Response.StreamPart>`.
// The UI projects these into rendered transcript entries; tests assert on the
// collected sequence directly. The union lives here (not in the TUI) because
// `cli → tui → harness → tools` forbids the harness from importing tui types.
export type TurnEvent =
  | { readonly kind: "text-delta"; readonly id: string; readonly delta: string }
  | {
      readonly kind: "tool-call";
      readonly id: string;
      readonly name: string;
      readonly params: unknown;
    }
  | {
      readonly kind: "tool-result";
      readonly id: string;
      readonly name: string;
      readonly isFailure: boolean;
      readonly result: unknown;
    }
  | {
      readonly kind: "finish";
      readonly reason: string;
      readonly usage: RoundUsage;
    }
  | { readonly kind: "error"; readonly message: string };

// Per-Round token usage. `cacheReadTokens` is what proves the cacheControl
// marker is firing; `cacheWriteTokens` shows up on the first request of a
// session (and again whenever the cached prefix changes). Anthropic returns
// cache reads in `Response.Usage.cachedInputTokens` but stashes writes in
// `metadata.anthropic.usage.cache_creation_input_tokens` — see partToEvent.
export interface RoundUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export type StopCondition = (state: { readonly step: number }) => boolean;

// Mirrors opencode's predicate (repos/opencode/packages/llm/src/tool-runtime.ts:53).
// `step` is the just-finished round's 0-based index, so `stepCountIs(2)` lets two
// rounds happen before the loop bails.
export const stepCountIs =
  (count: number): StopCondition =>
  (state) =>
    state.step + 1 >= count;

// Cast helper: `StreamPart<Tools>` narrows away tool-call/tool-result when Tools
// is `never`, so we widen to access the discriminant `type` and per-kind fields.
type AnyStreamPart =
  | (Response.StreamPart<Record<string, never>> & { readonly type: string })
  | {
      readonly type: "tool-call";
      readonly id: string;
      readonly name: string;
      readonly params: unknown;
    }
  | {
      readonly type: "tool-result";
      readonly id: string;
      readonly name: string;
      readonly isFailure: boolean;
      readonly result: unknown;
    };

const partToEvent = (raw: unknown): TurnEvent | undefined => {
  const part = raw as AnyStreamPart;
  switch (part.type) {
    case "text-delta": {
      const td = part as { readonly id: string; readonly delta: string };
      return { kind: "text-delta", id: td.id, delta: td.delta };
    }
    case "tool-call": {
      const tc = part as {
        readonly id: string;
        readonly name: string;
        readonly params: unknown;
      };
      return { kind: "tool-call", id: tc.id, name: tc.name, params: tc.params };
    }
    case "tool-result": {
      const tr = part as {
        readonly id: string;
        readonly name: string;
        readonly isFailure: boolean;
        readonly result: unknown;
      };
      return {
        kind: "tool-result",
        id: tr.id,
        name: tr.name,
        isFailure: tr.isFailure,
        result: tr.result,
      };
    }
    case "finish": {
      const fp = part as {
        readonly reason: string;
        readonly usage?: {
          readonly inputTokens?: number;
          readonly outputTokens?: number;
          readonly cachedInputTokens?: number;
        };
        readonly metadata?: {
          readonly anthropic?: {
            readonly usage?: { readonly cache_creation_input_tokens?: number | null };
          };
        };
      };
      const cacheWrite = fp.metadata?.anthropic?.usage?.cache_creation_input_tokens ?? 0;
      return {
        kind: "finish",
        reason: fp.reason,
        usage: {
          inputTokens: fp.usage?.inputTokens ?? 0,
          outputTokens: fp.usage?.outputTokens ?? 0,
          cacheReadTokens: fp.usage?.cachedInputTokens ?? 0,
          cacheWriteTokens: cacheWrite,
        },
      };
    }
    case "error": {
      const ep = part as { readonly error: unknown };
      return {
        kind: "error",
        message:
          ep.error instanceof Error
            ? ep.error.message
            : typeof ep.error === "string"
              ? ep.error
              : JSON.stringify(ep.error),
      };
    }
    default:
      return undefined;
  }
};

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);

export interface RunAgentTurnOptions {
  readonly chat: Chat.Service;
  readonly prompt: string;
  readonly stopWhen?: StopCondition;
}

// Drives a single user prompt across as many sampling rounds as the model needs.
// After each round's `finish`, if `finishReason === "tool-calls"` and `stopWhen`
// (default: none) returns false, we recurse with an empty user prompt — Chat
// already threads the prior round's tool results into history via its internal
// `acquireUseRelease` (repos/effect/packages/ai/ai/src/Chat.ts:381). Errors on
// the model stream are converted into one trailing `{ kind: "error" }` event;
// the helper never fails on its error channel.
//
// Mirrors the recursive-stream shape of opencode's `stream` helper
// (repos/opencode/packages/llm/src/tool-runtime.ts:64-148): a local `loop(step)`
// returns `Stream.unwrap(Effect.gen(...))` that concatenates the model stream
// with a conditional continuation stream.
export const runAgentTurn = (options: RunAgentTurnOptions) => {
  const { chat, prompt, stopWhen } = options;

  const loop = (step: number): Stream.Stream<TurnEvent, never, never> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const finishRef = yield* Ref.make<string | undefined>(undefined);
        const erroredRef = yield* Ref.make(false);
        const toolkit = yield* HarnessToolkit;

        // Round 0 sends the user's prompt; subsequent rounds send `Prompt.empty`
        // so Chat.streamText doesn't prepend a phantom empty user turn before
        // the model sees the tool results it just produced.
        const userPrompt = step === 0 ? prompt : Prompt.empty;

        const modelStream = chat.streamText({ prompt: userPrompt, toolkit }).pipe(
          Stream.tap((part) => {
            const p = part as AnyStreamPart;
            if (p.type === "finish") {
              const fp = p as { readonly reason: string };
              return Ref.set(finishRef, fp.reason);
            }
            return Effect.void;
          }),
          Stream.map(partToEvent),
          Stream.filter((e): e is TurnEvent => e !== undefined),
          Stream.catchAll((err) =>
            Stream.fromEffect(
              Effect.gen(function* () {
                yield* Ref.set(erroredRef, true);
                return { kind: "error", message: errorMessage(err) } as TurnEvent;
              }),
            ),
          ),
        );

        const continuation: Stream.Stream<TurnEvent, never, never> = Stream.unwrap(
          Effect.gen(function* () {
            const errored = yield* Ref.get(erroredRef);
            if (errored) return Stream.empty;
            const finish = yield* Ref.get(finishRef);
            if (finish !== "tool-calls") return Stream.empty;
            if (stopWhen !== undefined && stopWhen({ step })) {
              return Stream.succeed<TurnEvent>({
                kind: "error",
                message: `Agent loop stopped: step cap reached after ${step + 1} round${
                  step === 0 ? "" : "s"
                }.`,
              });
            }
            return loop(step + 1);
          }),
        );

        return modelStream.pipe(Stream.concat(continuation));
      }),
    ) as Stream.Stream<TurnEvent, never, never>;

  return loop(0);
};
