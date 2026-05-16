import { describe, expect, it } from "@effect/vitest";
import { Effect, Ref } from "effect";
import {
  type AgentsFileInfo,
  buildEnvironmentSystemPrompt,
  chatWithEnvironment,
  type SkillInfo,
} from "../src/index.ts";
import { withLanguageModel } from "./utilities.ts";

const ENV = {
  cwd: "/tmp/work",
  platform: "darwin",
  date: new Date("2026-05-14T00:00:00Z"),
};

const SAMPLE: SkillInfo = {
  name: "apple",
  description: "an apple skill",
  location: "/tmp/x/apple/SKILL.md",
  content: "body",
};

const SAMPLE_AGENTS: AgentsFileInfo = {
  source: "/tmp/work/AGENTS.md",
  content: "# Project rules\n- be terse",
};

describe("buildEnvironmentSystemPrompt", () => {
  it.effect("builds an env block containing cwd, platform, and date", () =>
    Effect.sync(() => {
      const out = buildEnvironmentSystemPrompt(ENV);
      const expectedDate = new Date("2026-05-14T00:00:00Z").toDateString();
      expect(out).toContain("<env>");
      expect(out).toContain("</env>");
      expect(out).toContain("Working directory: /tmp/work");
      expect(out).toContain("Platform: darwin");
      expect(out).toContain(`Today's date: ${expectedDate}`);
    }),
  );

  it.effect("orders env lines: cwd, platform, date", () =>
    Effect.sync(() => {
      const out = buildEnvironmentSystemPrompt(ENV);
      const iCwd = out.indexOf("Working directory:");
      const iPlat = out.indexOf("Platform:");
      const iDate = out.indexOf("Today's date:");
      expect(iCwd).toBeGreaterThan(-1);
      expect(iPlat).toBeGreaterThan(iCwd);
      expect(iDate).toBeGreaterThan(iPlat);
    }),
  );
});

describe("buildEnvironmentSystemPrompt skills block", () => {
  it.effect("omits <available_skills> when skills is undefined", () =>
    Effect.sync(() => {
      const out = buildEnvironmentSystemPrompt(ENV);
      expect(out).not.toContain("<available_skills>");
    }),
  );

  it.effect("omits <available_skills> when skills is empty array", () =>
    Effect.sync(() => {
      const out = buildEnvironmentSystemPrompt({ ...ENV, skills: [] });
      expect(out).not.toContain("<available_skills>");
    }),
  );

  it.effect("appends verbose <available_skills> block sorted by name", () =>
    Effect.sync(() => {
      const zebra: SkillInfo = { ...SAMPLE, name: "zebra", description: "z" };
      const apple: SkillInfo = { ...SAMPLE, name: "apple", description: "a" };
      const out = buildEnvironmentSystemPrompt({ ...ENV, skills: [zebra, apple] });
      expect(out).toContain("<available_skills>");
      const appleIdx = out.indexOf("<name>apple</name>");
      const zebraIdx = out.indexOf("<name>zebra</name>");
      expect(appleIdx).toBeGreaterThan(-1);
      expect(zebraIdx).toBeGreaterThan(appleIdx);
      expect(out).toContain(
        "Skills provide specialized instructions and workflows for specific tasks.",
      );
    }),
  );

  it.effect("emits <location> as a file:// URL", () =>
    Effect.sync(() => {
      const out = buildEnvironmentSystemPrompt({ ...ENV, skills: [SAMPLE] });
      expect(out).toContain("<location>file:///tmp/x/apple/SKILL.md</location>");
    }),
  );
});

describe("buildEnvironmentSystemPrompt project_instructions block", () => {
  it.effect("omits <project_instructions> when agentsFile is undefined", () =>
    Effect.sync(() => {
      const out = buildEnvironmentSystemPrompt(ENV);
      expect(out).not.toContain("<project_instructions");
    }),
  );

  it.effect("appends <project_instructions> after env, before skills", () =>
    Effect.sync(() => {
      const out = buildEnvironmentSystemPrompt({
        ...ENV,
        agentsFile: SAMPLE_AGENTS,
        skills: [SAMPLE],
      });
      const iEnvClose = out.indexOf("</env>");
      const iProj = out.indexOf("<project_instructions");
      const iProjClose = out.indexOf("</project_instructions>");
      const iSkills = out.indexOf("<available_skills>");
      expect(iEnvClose).toBeGreaterThan(-1);
      expect(iProj).toBeGreaterThan(iEnvClose);
      expect(iProjClose).toBeGreaterThan(iProj);
      expect(iSkills).toBeGreaterThan(iProjClose);
    }),
  );

  it.effect("renders <project_instructions> when no skills are present", () =>
    Effect.sync(() => {
      const out = buildEnvironmentSystemPrompt({ ...ENV, agentsFile: SAMPLE_AGENTS });
      expect(out).toContain("<project_instructions");
      expect(out).toContain("</project_instructions>");
      expect(out).not.toContain("<available_skills>");
    }),
  );

  it.effect("source attribute uses the absolute path verbatim", () =>
    Effect.sync(() => {
      const out = buildEnvironmentSystemPrompt({
        ...ENV,
        agentsFile: { source: "/tmp/x/AGENTS.md", content: "" },
      });
      expect(out).toContain('<project_instructions source="/tmp/x/AGENTS.md">');
    }),
  );

  it.effect("body is the file content verbatim including whitespace", () =>
    Effect.sync(() => {
      const body = "  - item with leading spaces\n```ts\nconst x = 1;\n```\n";
      const out = buildEnvironmentSystemPrompt({
        ...ENV,
        agentsFile: { source: "/tmp/x/AGENTS.md", content: body },
      });
      const opening = '<project_instructions source="/tmp/x/AGENTS.md">\n';
      const closing = "\n</project_instructions>";
      const start = out.indexOf(opening);
      expect(start).toBeGreaterThan(-1);
      const inner = out.slice(start + opening.length, out.indexOf(closing, start));
      expect(inner).toBe(body);
    }),
  );

  it.effect("escapes a double-quote in the source attribute", () =>
    Effect.sync(() => {
      const out = buildEnvironmentSystemPrompt({
        ...ENV,
        agentsFile: { source: '/tmp/we"ird/AGENTS.md', content: "x" },
      });
      expect(out).toContain('source="/tmp/we&quot;ird/AGENTS.md"');
    }),
  );
});

describe("chatWithEnvironment", () => {
  it.effect("seeds history with one system message", () =>
    Effect.gen(function* () {
      const chat = yield* chatWithEnvironment(ENV);
      const history = yield* Ref.get(chat.history);
      expect(history.content).toHaveLength(1);
      const msg = history.content[0];
      expect(msg?.role).toBe("system");
      if (msg?.role === "system") {
        expect(msg.content).toBe(buildEnvironmentSystemPrompt(ENV));
      }
    }).pipe(withLanguageModel({})),
  );

  // The cacheControl marker on the system message is the entire fix for the
  // Anthropic ITPM rate-limit (docs/adr/0002). It's a wire-format metadata
  // field — invisible at runtime — so a regression silently kills caching.
  // This assertion is the load-bearing regression test.
  it.effect("marks the system message with anthropic.cacheControl ephemeral", () =>
    Effect.gen(function* () {
      const chat = yield* chatWithEnvironment(ENV);
      const history = yield* Ref.get(chat.history);
      const msg = history.content[0];
      expect(msg?.role).toBe("system");
      if (msg?.role === "system") {
        const options = msg.options as
          | { readonly anthropic?: { readonly cacheControl?: { readonly type: string } } }
          | undefined;
        expect(options?.anthropic?.cacheControl).toEqual({ type: "ephemeral" });
      }
    }).pipe(withLanguageModel({})),
  );
});
