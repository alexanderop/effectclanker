import { Prompt, type Chat } from "@effect/ai";
import { Effect, Ref, Stream } from "effect";
import { runAgentTurn, stepCountIs, type TurnEvent } from "@effectclanker/harness";

export type { TurnEvent };

export interface RunChatTurnOptions {
  readonly chat: Chat.Service;
  readonly prompt: string;
  readonly onEvent: (event: TurnEvent) => Effect.Effect<void>;
}

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

// Drive one chat turn. Thin adapter over `runAgentTurn`: streams the agent loop
// (model + tool dispatch across as many rounds as the model needs, capped at
// `stepCountIs(25)`) and forwards each emitted `TurnEvent` to `onEvent`. The
// underlying helper surfaces all errors as `{ kind: "error" }` events, so this
// adapter's Effect never fails on its error channel.
export const runChatTurn = (options: RunChatTurnOptions) => {
  const { chat, onEvent, prompt } = options;
  return runAgentTurn({ chat, prompt, stopWhen: stepCountIs(25) }).pipe(Stream.runForEach(onEvent));
};
