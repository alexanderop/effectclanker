import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { TurnEvent } from "@effectclanker/harness";
import { makeChatStateController } from "../src/chat-state.ts";

const finishEvent = (
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
): TurnEvent => ({
  kind: "finish",
  reason: "stop",
  usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
});

describe("chat-state cumulative usage", () => {
  it.effect("starts at zero", () =>
    Effect.sync(() => {
      const controller = makeChatStateController();
      const snap = controller.snapshot();
      expect(snap.usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      expect(snap.lastRoundUsage).toBeNull();
    }),
  );

  it.effect("records the last round's usage separately from the cumulative total", () =>
    Effect.sync(() => {
      const controller = makeChatStateController();
      controller.applyEvent(finishEvent(100, 50, 0, 800));
      controller.applyEvent(finishEvent(150, 75, 800, 0));
      expect(controller.snapshot().lastRoundUsage).toEqual({
        inputTokens: 150,
        outputTokens: 75,
        cacheReadTokens: 800,
        cacheWriteTokens: 0,
      });
    }),
  );

  // Two Rounds in one session: the first writes the cache (a few hundred
  // write-tokens, no reads), the second hits it (no writes, many reads).
  // The cumulative snapshot must add both rounds; future-me will use the
  // R-token total in the footer to verify caching is firing.
  it.effect("sums usage across multiple finish events", () =>
    Effect.sync(() => {
      const controller = makeChatStateController();
      controller.applyEvent(finishEvent(100, 50, 0, 800));
      controller.applyEvent(finishEvent(150, 75, 800, 0));
      expect(controller.snapshot().usage).toEqual({
        inputTokens: 250,
        outputTokens: 125,
        cacheReadTokens: 800,
        cacheWriteTokens: 800,
      });
    }),
  );

  it.effect("ignores non-finish events for usage accounting", () =>
    Effect.sync(() => {
      const controller = makeChatStateController();
      controller.applyEvent({ kind: "text-delta", id: "t1", delta: "hi" });
      controller.applyEvent({ kind: "error", message: "oops" });
      expect(controller.snapshot().usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
    }),
  );
});
