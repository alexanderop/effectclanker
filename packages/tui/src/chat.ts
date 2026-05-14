import { Prompt, type Chat } from "@effect/ai";
import type * as Response from "@effect/ai/Response";
import { Effect, Ref, Stream } from "effect";
import { HarnessToolkit } from "@effectclanker/harness";

// Events emitted while consuming one turn's Stream<Response.StreamPart>.
// The UI projects these into rendered transcript entries; tests assert on the
// collected sequence directly.
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
  | { readonly kind: "finish"; readonly reason: string }
  | { readonly kind: "error"; readonly message: string };

export interface RunChatTurnOptions {
  readonly chat: Chat.Service;
  readonly prompt: string;
  readonly onEvent: (event: TurnEvent) => Effect.Effect<void>;
}

// Cast helper: StreamPart<Tools> narrows away tool-call/tool-result when Tools
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
      const fp = part as { readonly reason: string };
      return { kind: "finish", reason: fp.reason };
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

// Result of dispatching a slash command. The chat loop reacts to each variant:
//   - `handled` — show the returned text in the transcript, do not call the model
//   - `cleared` — same as handled, but the loop also knows history was reset
//   - `quit`    — interrupt the input fiber and shut the UI down
//   - `passthrough` — forward the original text to the model as a normal turn
export type SlashCommandResult =
  | { readonly kind: "handled"; readonly text: string }
  | { readonly kind: "cleared"; readonly text: string }
  | { readonly kind: "quit" }
  | { readonly kind: "passthrough"; readonly text: string };

const HELP_TEXT = "/exit quits, /clear resets conversation history, /help shows this list.";

// Dispatch a user-typed line. Lines that don't start with `/` are not slash
// commands at all and would never call this function; the public contract here
// is "given a line that starts with `/`, decide what to do with it".
export const slashCommand = (
  line: string,
  chat: Chat.Service,
): Effect.Effect<SlashCommandResult> => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) {
    return Effect.succeed({ kind: "passthrough", text: line });
  }
  const head = trimmed.split(/\s+/u, 1)[0] ?? trimmed;
  switch (head) {
    case "/exit":
      return Effect.succeed({ kind: "quit" });
    case "/help":
      return Effect.succeed({ kind: "handled", text: HELP_TEXT });
    case "/clear":
      return Ref.set(chat.history, Prompt.empty).pipe(
        Effect.as<SlashCommandResult>({ kind: "cleared", text: "Conversation cleared." }),
      );
    default:
      return Effect.succeed({ kind: "passthrough", text: line });
  }
};

// Drive one chat turn. Streams `chat.streamText(...)` through HarnessToolkit,
// converts each part into a TurnEvent, and hands events to `onEvent`. Any
// failure on the stream's error channel is converted into a single
// `{ kind: "error" }` event so the loop stays alive.
export const runChatTurn = (options: RunChatTurnOptions) => {
  const { chat, onEvent, prompt } = options;
  const userPrompt: Prompt.RawInput = prompt;
  return chat.streamText({ prompt: userPrompt, toolkit: HarnessToolkit }).pipe(
    Stream.runForEach((part) => {
      const event = partToEvent(part);
      return event === undefined ? Effect.void : onEvent(event);
    }),
    Effect.catchAll((error) =>
      onEvent({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : JSON.stringify(error),
      }),
    ),
  );
};
