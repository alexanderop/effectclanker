import type { TurnEvent } from "./chat.ts";
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

export interface ChatStateSnapshot {
  readonly transcript: ReadonlyArray<TranscriptEntry>;
  readonly status: ChatStatus;
  readonly plan: ReadonlyArray<PlanStep>;
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
  const listeners = new Set<Listener>();

  const emit = (): void => {
    const snap: ChatStateSnapshot = { transcript, status, plan };
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
    snapshot: () => ({ transcript, status, plan }),
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
          break;
      }
      emit();
    },
  };
};
