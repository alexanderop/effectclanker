import { AiError, Chat } from "@effect/ai";
import type * as Response from "@effect/ai/Response";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Ref, Stream } from "effect";
import { HarnessToolkitLayer } from "../src/index.ts";
import { runAgentTurn, stepCountIs, type TurnEvent } from "../src/agent-loop.ts";
import { withLanguageModel } from "./utilities.ts";

const finishPart = (reason: Response.FinishReason): Response.StreamPartEncoded => ({
  type: "finish",
  reason,
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
});

const textParts = (id: string, value: string): ReadonlyArray<Response.StreamPartEncoded> => [
  { type: "text-start", id },
  { type: "text-delta", id, delta: value },
  { type: "text-end", id },
];

const toolCallPart = (id: string, name: string, params: unknown): Response.StreamPartEncoded => ({
  type: "tool-call",
  id,
  name,
  params,
});

const collect = (
  stream: Stream.Stream<TurnEvent, never, never>,
): Effect.Effect<ReadonlyArray<TurnEvent>, never, never> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make<ReadonlyArray<TurnEvent>>([]);
    yield* stream.pipe(Stream.runForEach((e) => Ref.update(ref, (xs) => [...xs, e])));
    return yield* Ref.get(ref);
  });

describe("runAgentTurn", () => {
  it.effect("continues until finishReason is not tool-calls", () => {
    let call = 0;
    const streamText = () => {
      call++;
      if (call === 1) {
        return [toolCallPart("c1", "update_plan", { steps: [] }), finishPart("tool-calls")];
      }
      return [...textParts("t1", "done"), finishPart("stop")];
    };

    return Effect.gen(function* () {
      const chat = yield* Chat.empty;
      const events = yield* collect(runAgentTurn({ chat, prompt: "x" }));
      expect(call).toBe(2);
      const textJoined = events
        .filter((e): e is Extract<TurnEvent, { kind: "text-delta" }> => e.kind === "text-delta")
        .map((e) => e.delta)
        .join("");
      expect(textJoined).toContain("done");
    }).pipe(withLanguageModel({ streamText }), Effect.provide(HarnessToolkitLayer));
  });

  it.effect("stops at stepCountIs(2) even when model still requests tools", () => {
    let call = 0;
    const streamText = () => {
      call++;
      return [toolCallPart(`c${call}`, "update_plan", { steps: [] }), finishPart("tool-calls")];
    };

    return Effect.gen(function* () {
      const chat = yield* Chat.empty;
      const events = yield* collect(runAgentTurn({ chat, prompt: "x", stopWhen: stepCountIs(2) }));
      expect(call).toBe(2);
      const last = events.at(-1);
      expect(last?.kind).toBe("error");
      if (last?.kind === "error") {
        expect(last.message).toMatch(/cap|step|stop/iu);
      }
    }).pipe(withLanguageModel({ streamText }), Effect.provide(HarnessToolkitLayer));
  });

  it.effect("surfaces stream errors as an error event, not a thrown failure", () =>
    Effect.gen(function* () {
      const chat = yield* Chat.empty;
      const events = yield* collect(runAgentTurn({ chat, prompt: "x" }));
      const errors = events.filter((e) => e.kind === "error");
      expect(errors).toHaveLength(1);
      expect(events.at(-1)?.kind).toBe("error");
    }).pipe(
      withLanguageModel({
        streamText: () =>
          Stream.fail(
            new AiError.MalformedOutput({
              module: "test",
              method: "streamText",
              description: "boom",
            }),
          ),
      }),
      Effect.provide(HarnessToolkitLayer),
    ),
  );

  it.effect("stops on finishReason 'pause' without recursing", () => {
    let call = 0;
    const streamText = () => {
      call++;
      return [toolCallPart(`c${call}`, "update_plan", { steps: [] }), finishPart("pause")];
    };

    return Effect.gen(function* () {
      const chat = yield* Chat.empty;
      const events = yield* collect(runAgentTurn({ chat, prompt: "x" }));
      expect(call).toBe(1);
      const finishes = events.filter((e) => e.kind === "finish");
      expect(finishes).toHaveLength(1);
      expect(finishes[0]?.kind === "finish" ? finishes[0].reason : "").toBe("pause");
      expect(events.some((e) => e.kind === "error")).toBe(false);
    }).pipe(withLanguageModel({ streamText }), Effect.provide(HarnessToolkitLayer));
  });
});
