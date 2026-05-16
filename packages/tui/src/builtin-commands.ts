import { Prompt, type Chat } from "@effect/ai";
import { Effect, Ref } from "effect";
import type { SlashCommandResult } from "./chat.ts";

export interface BuiltinContext {
  readonly chat: Chat.Service;
  readonly clearTo: Prompt.RawInput;
  readonly helpText: string;
}

export interface BuiltinCommand {
  readonly name: string;
  readonly description: string;
  readonly run: (ctx: BuiltinContext) => Effect.Effect<SlashCommandResult>;
}

export const BUILTINS: ReadonlyArray<BuiltinCommand> = [
  {
    name: "exit",
    description: "Quit the chat",
    run: () => Effect.succeed({ kind: "quit" }),
  },
  {
    name: "help",
    description: "Show available slash commands",
    run: ({ helpText }) => Effect.succeed({ kind: "handled", text: helpText }),
  },
  {
    name: "clear",
    description: "Reset conversation history",
    run: ({ chat, clearTo }) =>
      Ref.set(chat.history, Prompt.make(clearTo)).pipe(
        Effect.as<SlashCommandResult>({ kind: "cleared", text: "Conversation cleared." }),
      ),
  },
];
