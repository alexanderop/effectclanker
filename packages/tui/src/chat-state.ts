import type { RoundUsage, TurnEvent } from "@effectclanker/harness";
import type { PlanStep } from "@effectclanker/tools";

// Imperative store that bridges the Effect-driven chat loop and the React/Ink
// renderer. The chat loop calls the mutating methods; React subscribes via the
// `useChatState` hook in chat-ui.tsx and re-renders on every change.

export type TranscriptEntry =
  | { readonly kind: "user"; readonly text: string }
  | { readonly kind: "assistant"; readonly id: string; readonly text: string }
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
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "system"; readonly text: string };

export type ChatStatus = "ready" | "streaming";

// Cumulative session-wide token totals across every Round's finish event.
// Rendered as a pi-style status line in the chat footer; non-zero
// `cacheReadTokens` is the live signal that the cacheControl breakpoint on
// the system message is firing.
export interface CumulativeUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

const EMPTY_CUMULATIVE_USAGE: CumulativeUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const addUsage = (acc: CumulativeUsage, delta: RoundUsage): CumulativeUsage => ({
  inputTokens: acc.inputTokens + delta.inputTokens,
  outputTokens: acc.outputTokens + delta.outputTokens,
  cacheReadTokens: acc.cacheReadTokens + delta.cacheReadTokens,
  cacheWriteTokens: acc.cacheWriteTokens + delta.cacheWriteTokens,
});

export interface ChatStateSnapshot {
  readonly transcript: ReadonlyArray<TranscriptEntry>;
  readonly status: ChatStatus;
  readonly plan: ReadonlyArray<PlanStep>;
  readonly usage: CumulativeUsage;
  // The most recent Round's usage. Cumulative `usage` keeps growing each round
  // and is useful for caching diagnostics, but it does not represent *current*
  // context-window occupancy — that's approximately the last round's
  // input + cacheRead + cacheWrite tokens. Drives the Claude Code-style
  // context-window bar in the status line.
  readonly lastRoundUsage: RoundUsage | null;
}

type Listener = (snapshot: ChatStateSnapshot) => void;

export interface ChatStateController {
  readonly snapshot: () => ChatStateSnapshot;
  readonly subscribe: (listener: Listener) => () => void;
  readonly appendUser: (text: string) => void;
  readonly appendSystem: (text: string) => void;
  readonly setStatus: (status: ChatStatus) => void;
  readonly applyEvent: (event: TurnEvent) => void;
  readonly setPlan: (plan: ReadonlyArray<PlanStep>) => void;
  readonly clearTranscript: () => void;
}

export const makeChatStateController = (): ChatStateController => {
  let transcript: ReadonlyArray<TranscriptEntry> = [];
  let status: ChatStatus = "ready";
  let plan: ReadonlyArray<PlanStep> = [];
  let usage: CumulativeUsage = EMPTY_CUMULATIVE_USAGE;
  let lastRoundUsage: RoundUsage | null = null;
  const listeners = new Set<Listener>();

  const emit = (): void => {
    const snap: ChatStateSnapshot = { transcript, status, plan, usage, lastRoundUsage };
    for (const cb of listeners) cb(snap);
  };

  const append = (entry: TranscriptEntry): void => {
    transcript = [...transcript, entry];
  };

  const updateAssistant = (id: string, delta: string): void => {
    const last = transcript.at(-1);
    if (last && last.kind === "assistant" && last.id === id) {
      const updated: TranscriptEntry = { kind: "assistant", id, text: last.text + delta };
      transcript = [...transcript.slice(0, -1), updated];
    } else {
      transcript = [...transcript, { kind: "assistant", id, text: delta }];
    }
  };

  return {
    snapshot: () => ({ transcript, status, plan, usage, lastRoundUsage }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    appendUser: (text) => {
      append({ kind: "user", text });
      emit();
    },
    appendSystem: (text) => {
      append({ kind: "system", text });
      emit();
    },
    setStatus: (next) => {
      status = next;
      emit();
    },
    setPlan: (next) => {
      plan = next;
      emit();
    },
    clearTranscript: () => {
      transcript = [];
      emit();
    },
    applyEvent: (event) => {
      switch (event.kind) {
        case "text-delta":
          updateAssistant(event.id, event.delta);
          break;
        case "tool-call":
          append({
            kind: "tool-call",
            id: event.id,
            name: event.name,
            params: event.params,
          });
          break;
        case "tool-result":
          append({
            kind: "tool-result",
            id: event.id,
            name: event.name,
            isFailure: event.isFailure,
            result: event.result,
          });
          break;
        case "error":
          append({ kind: "error", message: event.message });
          break;
        case "finish":
          usage = addUsage(usage, event.usage);
          lastRoundUsage = event.usage;
          break;
      }
      emit();
    },
  };
};
