import type { SkillInfo } from "@effectclanker/tools";
import { BUILTINS } from "./builtin-commands.ts";

export interface SlashCommandEntry {
  readonly trigger: string;
  readonly description: string;
  readonly source: "builtin" | "skill";
}

export const listSlashCommands = (
  skills: ReadonlyArray<SkillInfo>,
): ReadonlyArray<SlashCommandEntry> => [
  ...BUILTINS.map((b) => ({
    trigger: `/${b.name}`,
    description: b.description,
    source: "builtin" as const,
  })),
  ...skills.map((s) => ({
    trigger: `/${s.name}`,
    description: s.description,
    source: "skill" as const,
  })),
];

// Prefix match on the trigger (without the slash). Hides as soon as a space
// appears in the draft — args have begun, no more completion.
export const filterSlashCommands = (
  draft: string,
  all: ReadonlyArray<SlashCommandEntry>,
): ReadonlyArray<SlashCommandEntry> => {
  if (!draft.startsWith("/") || draft.includes(" ")) return [];
  const query = draft.slice(1);
  return all.filter((entry) => entry.trigger.slice(1).startsWith(query));
};
