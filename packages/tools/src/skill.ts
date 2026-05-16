import { Tool } from "@effect/ai";
import { Effect, Schema } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

// Shape mirrored by `@effectclanker/harness`'s `Skills` service. Defined here
// because the tool spec / handler is the contract consumer; harness imports
// the type via its dependency on @effectclanker/tools (boundary: harness →
// tools).
export interface SkillInfo {
  readonly name: string;
  readonly description: string;
  readonly location: string;
  readonly content: string;
}

const buildSkillToolDescription = (skills: ReadonlyArray<SkillInfo>): string => {
  const sorted = [...skills].toSorted((a, b) => a.name.localeCompare(b.name));
  return [
    "Load a specialized skill that provides domain-specific instructions and workflows.",
    "",
    "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
    "",
    "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
    "",
    'Tool output includes a `<skill_content name="...">` block with the loaded content.',
    "",
    "The following skills provide specialized sets of instructions for particular tasks",
    "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
    "",
    ...sorted.map((s) => `- **${s.name}**: ${s.description}`),
  ].join("\n");
};

const listAdjacentFiles = async (skillDir: string): Promise<Array<string>> => {
  const entries = await fs.readdir(skillDir, { recursive: true, withFileTypes: true });
  const files: Array<string> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === "SKILL.md") continue;
    const parent =
      (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
      (entry as unknown as { path?: string }).path ??
      skillDir;
    files.push(path.join(parent, entry.name));
  }
  return files;
};

const renderSkillOutput = (info: SkillInfo, files: ReadonlyArray<string>): string => {
  const dir = path.dirname(info.location);
  const base = pathToFileURL(dir).href;
  const fileLines = files.map((f) => `<file>${f}</file>`).join("\n");
  return [
    `<skill_content name="${info.name}">`,
    `# Skill: ${info.name}`,
    "",
    info.content.trim(),
    "",
    `Base directory for this skill: ${base}`,
    "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
    "",
    "<skill_files>",
    fileLines,
    "</skill_files>",
    "</skill_content>",
  ].join("\n");
};

export interface SkillToolResult {
  readonly tool: ReturnType<typeof buildSkillTool>;
  readonly handler: (input: { readonly name: string }) => Effect.Effect<string>;
}

const buildSkillTool = (skills: ReadonlyArray<SkillInfo>) => {
  // Schema.Literal requires a NonEmpty tuple — gated above by length === 0
  // returning null. The cast forms the first/rest tuple Schema.Literal asks
  // for at the type level.
  const names = skills.map((s) => s.name) as [string, ...Array<string>];
  return Tool.make("skill", {
    description: buildSkillToolDescription(skills),
    parameters: {
      name: Schema.Literal(...names),
    },
    success: Schema.String,
    failureMode: "return",
  });
};

export const makeSkillTool = (skills: ReadonlyArray<SkillInfo>): SkillToolResult | null => {
  if (skills.length === 0) return null;
  const tool = buildSkillTool(skills);
  const byName = new Map(skills.map((s) => [s.name, s] as const));
  const handler = (input: { readonly name: string }): Effect.Effect<string> =>
    Effect.promise(async () => {
      const info = byName.get(input.name);
      if (info === undefined) {
        // Defensive: Schema.Literal should have already rejected unknown names
        // upstream. Reaching this branch implies a registry-time mismatch.
        return `<skill_content name="${input.name}">Skill not found.</skill_content>`;
      }
      const files = await listAdjacentFiles(path.dirname(info.location));
      return renderSkillOutput(info, files);
    });
  return { tool, handler };
};
