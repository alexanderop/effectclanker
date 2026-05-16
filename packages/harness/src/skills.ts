import type { SkillInfo } from "@effectclanker/tools";
import { Context, Effect, Layer } from "effect";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export type { SkillInfo };

export interface SkillsInterface {
  readonly all: ReadonlyArray<SkillInfo>;
  readonly get: (name: string) => SkillInfo | undefined;
}

export class Skills extends Context.Tag("@effectclanker/Skills")<Skills, SkillsInterface>() {}

// Builtin slash commands shadow same-named skills (see
// docs/adr/0001-builtin-slash-commands-shadow-skills.md). Discovery applies
// the filter so every downstream consumer (skill tool's Schema.Literal, the
// system-prompt block, picker, /help) sees the same shadow-filtered list.
const SHADOWED_BY_BUILTIN: ReadonlySet<string> = new Set(["clear", "exit", "help"]);

interface ParsedSkill {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}

// Hand-rolled — Claude Code / AGENTS SKILL.md frontmatter only has single-line
// `key: value` pairs. Returns null if the file isn't shaped like a skill.
const parseSkillMarkdown = (raw: string): ParsedSkill | null => {
  if (!raw.startsWith("---\n")) return null;
  const rest = raw.slice(4);
  const closingIndex = rest.indexOf("\n---\n");
  if (closingIndex === -1) return null;
  const frontmatter = rest.slice(0, closingIndex);
  let body = rest.slice(closingIndex + "\n---\n".length);
  if (body.startsWith("\n")) body = body.slice(1);

  let name: string | undefined;
  let description: string | undefined;
  for (const line of frontmatter.split("\n")) {
    if (line.trim().length === 0) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === "name") name = value;
    else if (key === "description") description = value;
  }
  if (name === undefined || description === undefined) return null;
  return { name, description, content: body };
};

const isDirectory = async (p: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

const scanRoot = async (root: string): Promise<Array<SkillInfo>> => {
  if (!(await isDirectory(root))) return [];
  let entries: Array<Dirent>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries.filter((e) => e.isDirectory());
  const reads = await Promise.all(
    dirs.map(async (entry) => {
      const skillPath = path.join(root, entry.name, "SKILL.md");
      try {
        const raw = await fs.readFile(skillPath, "utf8");
        return { skillPath, raw } as const;
      } catch {
        return null;
      }
    }),
  );
  const skills: Array<SkillInfo> = [];
  for (const r of reads) {
    if (r === null) continue;
    const parsed = parseSkillMarkdown(r.raw);
    if (parsed === null) {
      console.warn(
        `Skipping ${r.skillPath}: missing leading --- fence or required name/description.`,
      );
      continue;
    }
    skills.push({
      name: parsed.name,
      description: parsed.description,
      location: r.skillPath,
      content: parsed.content,
    });
  }
  return skills;
};

const isSameContent = (a: SkillInfo, b: SkillInfo): boolean =>
  a.description === b.description && a.content === b.content;

// Exposed for tests — production callers go through SkillsLayer.
// Roots are scanned in array order; later roots override earlier ones for the
// same skill name. This implements the project-overrides-global precedence
// without an explicit "scope" field on each match. When a later definition is
// byte-identical to an earlier one (common when users mirror skills between
// ~/.claude/skills and ~/.agents/skills), the override is silent — only real
// content drift is worth surfacing.
export const scanSkills = (roots: ReadonlyArray<string>): Effect.Effect<Array<SkillInfo>> =>
  Effect.promise(async () => {
    const perRoot = await Promise.all(roots.map((r) => scanRoot(r)));
    const byName = new Map<string, SkillInfo>();
    for (const found of perRoot) {
      for (const skill of found) {
        const existing = byName.get(skill.name);
        if (existing !== undefined && !isSameContent(existing, skill)) {
          console.warn(
            `Skill "${skill.name}" at ${skill.location} overrides earlier definition at ${existing.location} with different content.`,
          );
        }
        byName.set(skill.name, skill);
      }
    }
    const filtered: Array<SkillInfo> = [];
    for (const skill of byName.values()) {
      if (SHADOWED_BY_BUILTIN.has(skill.name)) {
        console.warn(
          `Skill "${skill.name}" at ${skill.location} is shadowed by builtin /${skill.name} and will not be invokable. Rename the skill folder to use it.`,
        );
        continue;
      }
      filtered.push(skill);
    }
    return filtered;
  });

const productionRoots = (): ReadonlyArray<string> => [
  path.join(os.homedir(), ".claude", "skills"),
  path.join(os.homedir(), ".agents", "skills"),
  path.join(process.cwd(), ".claude", "skills"),
  path.join(process.cwd(), ".agents", "skills"),
];

const makeSkillsService = (skills: ReadonlyArray<SkillInfo>): SkillsInterface => {
  const frozen = Object.freeze([...skills]);
  const byName = new Map(frozen.map((s) => [s.name, s] as const));
  return {
    all: frozen,
    get: (name: string) => byName.get(name),
  };
};

export const makeSkillsLayer = (roots: ReadonlyArray<string>): Layer.Layer<Skills> =>
  Layer.effect(Skills, scanSkills(roots).pipe(Effect.map(makeSkillsService)));

export const SkillsLayer: Layer.Layer<Skills> = Layer.effect(
  Skills,
  Effect.suspend(() => scanSkills(productionRoots()).pipe(Effect.map(makeSkillsService))),
);
