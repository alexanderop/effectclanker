import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as path from "node:path";
import { makeSkillTool, type SkillInfo } from "../src/skill.ts";
import { withTmpDir, writeFiles } from "./utilities.ts";

const sampleSkill = (location: string): SkillInfo => ({
  name: "demo",
  description: "demo skill",
  location,
  content: "Run the demo.",
});

describe("makeSkillTool", () => {
  it.effect("handler renders skill body, base directory, and adjacent files", () =>
    withTmpDir("skill", (dir) =>
      Effect.gen(function* () {
        const skillDir = path.join(dir, "demo");
        yield* writeFiles(dir, {
          "demo/SKILL.md": "ignored — handler reads info.content directly",
          "demo/scripts/foo.sh": "echo hi",
        });
        const info = sampleSkill(path.join(skillDir, "SKILL.md"));
        const built = makeSkillTool([info]);
        expect(built).not.toBeNull();
        if (built === null) return;
        const out = yield* built.handler({ name: "demo" });
        expect(out).toContain('<skill_content name="demo">');
        expect(out).toContain("# Skill: demo");
        expect(out).toContain("Run the demo.");
        expect(out).toContain(`Base directory for this skill: file://${skillDir}`);
        expect(out).toContain("Relative paths in this skill");
        expect(out).toContain("<skill_files>");
        expect(out).toContain(`<file>${path.join(skillDir, "scripts", "foo.sh")}</file>`);
        expect(out).toContain("</skill_files>");
        expect(out).toContain("</skill_content>");
      }),
    ),
  );

  it.effect("file list excludes SKILL.md itself", () =>
    withTmpDir("skill", (dir) =>
      Effect.gen(function* () {
        const skillDir = path.join(dir, "demo");
        yield* writeFiles(dir, {
          "demo/SKILL.md": "ignored",
          "demo/other.txt": "x",
        });
        const info = sampleSkill(path.join(skillDir, "SKILL.md"));
        const built = makeSkillTool([info]);
        if (built === null) return;
        const out = yield* built.handler({ name: "demo" });
        expect(out).not.toContain("SKILL.md</file>");
        expect(out).toContain(`<file>${path.join(skillDir, "other.txt")}</file>`);
      }),
    ),
  );

  it.effect("makeSkillTool returns null when given empty list", () =>
    Effect.sync(() => {
      expect(makeSkillTool([])).toBeNull();
    }),
  );

  it.effect("parameter schema is a Schema.Literal enum of the discovered names", () =>
    Effect.gen(function* () {
      const built = makeSkillTool([sampleSkill("/tmp/demo/SKILL.md")]);
      if (built === null) return;
      const decode = Schema.decodeUnknown(built.tool.parametersSchema);
      const ok = yield* decode({ name: "demo" });
      expect(ok.name).toBe("demo");
      const errored = yield* Effect.either(decode({ name: "bogus" }));
      expect(errored._tag).toBe("Left");
      if (errored._tag === "Left") {
        expect((errored.left as { _tag?: string })._tag).toBe("ParseError");
      }
    }),
  );
});
