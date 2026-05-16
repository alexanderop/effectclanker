import { Chat } from "@effect/ai";
import { pathToFileURL } from "node:url";
import type { AgentsFileInfo } from "./agents-file.ts";
import type { SkillInfo } from "./skills.ts";

export interface EnvironmentInfo {
  readonly cwd: string;
  readonly platform: string;
  readonly date: Date;
  readonly agentsFile?: AgentsFileInfo;
  readonly skills?: ReadonlyArray<SkillInfo>;
}

// Bare absolute path — not file:// — so the source stays readable next to
// <env>'s plain "Working directory: …". The skills block uses file:// URLs
// to mirror opencode; that anomaly is contained there. Quote-escape only;
// real filesystem paths almost never contain `"`, but if one does we keep
// the XML attribute well-formed.
const buildProjectInstructionsBlock = (info: AgentsFileInfo): string => {
  const escapedSource = info.source.replaceAll('"', "&quot;");
  return `<project_instructions source="${escapedSource}">\n${info.content}\n</project_instructions>`;
};

// Verbose XML format mirrors opencode's Skill.fmt(list, { verbose: true })
// (repos/opencode/.../skill/index.ts:296-313). Pinned this shape because
// opencode notes the model ingests verbose XML in system + compact md in tool
// description better than the reverse (session/system.ts:73-74).
const buildSkillsBlock = (skills: ReadonlyArray<SkillInfo>): string => {
  const sorted = [...skills].toSorted((a, b) => a.name.localeCompare(b.name));
  const lines: Array<string> = ["<available_skills>"];
  for (const skill of sorted) {
    lines.push("  <skill>");
    lines.push(`    <name>${skill.name}</name>`);
    lines.push(`    <description>${skill.description}</description>`);
    lines.push(`    <location>${pathToFileURL(skill.location).href}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  lines.push("");
  lines.push("Skills provide specialized instructions and workflows for specific tasks.");
  lines.push("Use the skill tool to load a skill when a task matches its description.");
  return lines.join("\n");
};

export const buildEnvironmentSystemPrompt = (env: EnvironmentInfo): string => {
  const base = `Here is some useful information about the environment you are running in:
<env>
  Working directory: ${env.cwd}
  Platform: ${env.platform}
  Today's date: ${env.date.toDateString()}
</env>`;
  // Order is fixed: env → project_instructions → available_skills. env is
  // mechanical scaffolding; project instructions are always-on behavior;
  // skills are an optional reactive menu listed last.
  const sections: Array<string> = [base];
  if (env.agentsFile !== undefined) {
    sections.push(buildProjectInstructionsBlock(env.agentsFile));
  }
  if (env.skills !== undefined && env.skills.length > 0) {
    sections.push(buildSkillsBlock(env.skills));
  }
  return sections.join("\n\n");
};

// The `cacheControl` marker tells Anthropic to cache the prefix up to and
// including this system message. Tools live before system in the wire-format
// prefix, so a single breakpoint here covers `tools + system` as one cached
// chunk — cache reads do not count against ITPM, which is the rate-limit
// regime that motivated this change. Other providers ignore the `anthropic`
// namespace. See docs/adr/0002-cache-system-prompt-only.md.
export const chatWithEnvironment = (env: EnvironmentInfo) =>
  Chat.fromPrompt([
    {
      role: "system",
      content: buildEnvironmentSystemPrompt(env),
      options: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
  ]);
