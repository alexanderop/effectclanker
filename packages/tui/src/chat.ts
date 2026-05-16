import { Prompt, type Chat } from "@effect/ai";
import { Effect, Stream } from "effect";
import {
  runAgentTurn,
  stepCountIs,
  type SkillsInterface,
  type TurnEvent,
} from "@effectclanker/harness";
import { BUILTINS } from "./builtin-commands.ts";

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

// /help body is derived from the live registries so adding a builtin or a
// skill never requires touching a string constant.
export const buildHelpText = (skills: SkillsInterface): string => {
  const builtinLines = [...BUILTINS]
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((b) => `  /${b.name} — ${b.description}`);
  const skillLines = [...skills.all]
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((s) => `  /${s.name} — ${s.description}`);
  const sections = [`Slash commands:`, ...builtinLines];
  if (skillLines.length > 0) {
    sections.push("");
    sections.push("Skills:");
    sections.push(...skillLines);
  }
  return sections.join("\n");
};

// `$ARGUMENTS` substitution with append-fallback. Numbered placeholders ($1,
// $N) are out of scope (see specs/pending/skills.md "Out of scope").
export const renderSkillTemplate = (body: string, args: string): string => {
  const trimmed = args.trim();
  if (body.includes("$ARGUMENTS")) return body.replaceAll("$ARGUMENTS", trimmed);
  if (trimmed.length > 0) return `${body}\n\n${trimmed}`;
  return body;
};

// Dispatch a user-typed line. Lines that don't start with `/` are not slash
// commands at all and would never call this function; the public contract here
// is "given a line that starts with `/`, decide what to do with it".
export const slashCommand = (
  line: string,
  chat: Chat.Service,
  skills: SkillsInterface,
  clearTo: Prompt.RawInput = Prompt.empty,
): Effect.Effect<SlashCommandResult> => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) {
    return Effect.succeed({ kind: "passthrough", text: line });
  }
  const parts = trimmed.slice(1).split(/\s+/u);
  const head = parts[0] ?? "";
  const args = parts.slice(1).join(" ");

  const builtin = BUILTINS.find((b) => b.name === head);
  if (builtin !== undefined) {
    const helpText = buildHelpText(skills);
    return builtin.run({ chat, clearTo, helpText });
  }
  const skill = skills.get(head);
  if (skill !== undefined) {
    return Effect.succeed({
      kind: "passthrough",
      text: renderSkillTemplate(skill.content, args),
    });
  }
  return Effect.succeed({ kind: "handled", text: `Unknown command: /${head}` });
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
