import { AiError, Chat, Prompt } from "@effect/ai";
import type * as Response from "@effect/ai/Response";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Ref, Stream } from "effect";
import { HarnessToolkitLayer } from "@effectclanker/harness";
import { runChatTurn, slashCommand, type TurnEvent } from "../src/chat.ts";
import { withLanguageModel } from "./utilities.ts";

const finishPart = (): Response.StreamPartEncoded => ({
  type: "finish",
  reason: "stop",
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  },
});

const textStart = (id: string): Response.StreamPartEncoded => ({
  type: "text-start",
  id,
});

const textDelta = (id: string, delta: string): Response.StreamPartEncoded => ({
  type: "text-delta",
  id,
  delta,
});

const textEnd = (id: string): Response.StreamPartEncoded => ({
  type: "text-end",
  id,
});

const text = (id: string, value: string): ReadonlyArray<Response.StreamPartEncoded> => [
  textStart(id),
  textDelta(id, value),
  textEnd(id),
];

const toolCallPart = (id: string, name: string, params: unknown): Response.StreamPartEncoded => ({
  type: "tool-call",
  id,
  name,
  params,
});

describe("chat loop", () => {
  it.effect("preserves prior turn's tool result across two turns", () => {
    let call = 0;
    const streamText = (opts: { readonly prompt: unknown }) => {
      call++;
      if (call === 1) {
        return [
          toolCallPart("call-1", "read", { path: "/no/such/path/xyz" }),
          ...text("text-1", "turn 1 reply"),
          finishPart(),
        ];
      }
      // Turn 2: assert the prior turn's assistant text + tool result made it
      // back into the prompt that Chat.streamText hands to the LanguageModel.
      const serialized = JSON.stringify(opts.prompt);
      expect(serialized).toContain("turn 1 reply");
      expect(serialized).toContain("/no/such/path/xyz");
      return [...text("text-2", "turn 2 reply"), finishPart()];
    };

    return Effect.gen(function* () {
      const events1 = yield* Ref.make<ReadonlyArray<TurnEvent>>([]);
      const events2 = yield* Ref.make<ReadonlyArray<TurnEvent>>([]);
      const chat = yield* Chat.empty;

      yield* runChatTurn({
        chat,
        prompt: "first",
        onEvent: (event) => Ref.update(events1, (xs) => [...xs, event]),
      });
      yield* runChatTurn({
        chat,
        prompt: "second",
        onEvent: (event) => Ref.update(events2, (xs) => [...xs, event]),
      });

      expect(call).toBe(2);
      const turn1 = yield* Ref.get(events1);
      const textEvents = turn1.filter((e) => e.kind === "text-delta");
      const joined = textEvents.map((e) => e.delta).join("");
      expect(joined).toContain("turn 1 reply");
      const toolCalls = turn1.filter((e) => e.kind === "tool-call");
      expect(toolCalls).toHaveLength(1);
      const toolResults = turn1.filter((e) => e.kind === "tool-result");
      expect(toolResults).toHaveLength(1);

      const turn2 = yield* Ref.get(events2);
      const turn2Text = turn2
        .filter((e) => e.kind === "text-delta")
        .map((e) => e.delta)
        .join("");
      expect(turn2Text).toContain("turn 2 reply");
    }).pipe(withLanguageModel({ streamText }), Effect.provide(HarnessToolkitLayer));
  });
});

describe("chat error handling", () => {
  it.effect("streamText error surfaces as a chat error event, not a thrown failure", () =>
    Effect.gen(function* () {
      const events = yield* Ref.make<ReadonlyArray<TurnEvent>>([]);
      const chat = yield* Chat.empty;
      yield* runChatTurn({
        chat,
        prompt: "hi",
        onEvent: (event) => Ref.update(events, (xs) => [...xs, event]),
      });
      const collected = yield* Ref.get(events);
      const errorEvents = collected.filter((e) => e.kind === "error");
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]?.kind).toBe("error");
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
});

describe("slashCommand", () => {
  it.effect("/clear resets Chat history", () =>
    Effect.gen(function* () {
      const chat = yield* Chat.empty;
      yield* Ref.set(chat.history, Prompt.make("seeded"));
      const result = yield* slashCommand("/clear", chat);
      expect(result.kind).toBe("cleared");
      const history = yield* Ref.get(chat.history);
      expect(history).toStrictEqual(Prompt.empty);
    }),
  );

  it.effect("/help returns the three command names", () =>
    Effect.gen(function* () {
      const chat = yield* Chat.empty;
      const result = yield* slashCommand("/help", chat);
      expect(result.kind).toBe("handled");
      if (result.kind === "handled") {
        expect(result.text).toContain("/exit");
        expect(result.text).toContain("/clear");
        expect(result.text).toContain("/help");
      }
    }),
  );

  it.effect("unknown /foo is forwarded to the model as-is", () =>
    Effect.gen(function* () {
      const chat = yield* Chat.empty;
      const result = yield* slashCommand("/foo bar", chat);
      expect(result).toStrictEqual({ kind: "passthrough", text: "/foo bar" });
    }),
  );

  it.effect("/exit returns a quit signal", () =>
    Effect.gen(function* () {
      const chat = yield* Chat.empty;
      const result = yield* slashCommand("/exit", chat);
      expect(result).toStrictEqual({ kind: "quit" });
    }),
  );
});
