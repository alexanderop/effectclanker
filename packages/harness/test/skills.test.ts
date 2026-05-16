import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { scanSkills } from "../src/skills.ts";
import { withTmpDir, writeFiles } from "./utilities.ts";

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe("scanSkills", () => {
  it.effect("parses name+description+content from a SKILL.md", () =>
    withTmpDir("skills", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, {
          "foo/SKILL.md": "---\nname: foo\ndescription: a foo\n---\nhello",
        });
        const skills = yield* scanSkills([dir]);
        expect(skills).toHaveLength(1);
        expect(skills[0]?.name).toBe("foo");
        expect(skills[0]?.description).toBe("a foo");
        expect(skills[0]?.content).toBe("hello");
        expect(skills[0]?.location).toBe(path.join(dir, "foo", "SKILL.md"));
      }),
    ),
  );

  it.effect("skips non-existent roots silently", () =>
    withTmpDir("skills", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, {
          "foo/SKILL.md": "---\nname: foo\ndescription: a foo\n---\nhello",
        });
        const missing = path.join(dir, "does-not-exist");
        const skills = yield* scanSkills([missing, dir]);
        expect(skills.map((s) => s.name)).toEqual(["foo"]);
      }),
    ),
  );

  it.effect("ignores SKILL.md missing the leading --- fence", () =>
    withTmpDir("skills", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "bad/SKILL.md": "no frontmatter here" });
        const skills = yield* scanSkills([dir]);
        expect(skills).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalled();
      }),
    ),
  );

  it.effect("requires both name and description", () =>
    withTmpDir("skills", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, {
          "bad/SKILL.md": "---\nname: bad\n---\nbody",
        });
        const skills = yield* scanSkills([dir]);
        expect(skills).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalled();
      }),
    ),
  );

  it.effect("later root overrides earlier root for the same name when content differs", () =>
    withTmpDir("skills-a", (rootA) =>
      withTmpDir("skills-b", (rootB) =>
        Effect.gen(function* () {
          yield* writeFiles(rootA, {
            "foo/SKILL.md": "---\nname: foo\ndescription: from A\n---\nA",
          });
          yield* writeFiles(rootB, {
            "foo/SKILL.md": "---\nname: foo\ndescription: from B\n---\nB",
          });
          const skills = yield* scanSkills([rootA, rootB]);
          expect(skills).toHaveLength(1);
          expect(skills[0]?.description).toBe("from B");
          expect(skills[0]?.location).toBe(path.join(rootB, "foo", "SKILL.md"));
          const warnCalls = warnSpy.mock.calls.flat().join(" ");
          expect(warnCalls).toMatch(/different content/);
        }),
      ),
    ),
  );

  it.effect("dedupes silently when later root has byte-identical content", () =>
    withTmpDir("skills-a", (rootA) =>
      withTmpDir("skills-b", (rootB) =>
        Effect.gen(function* () {
          const body = "---\nname: foo\ndescription: same\n---\nshared body";
          yield* writeFiles(rootA, { "foo/SKILL.md": body });
          yield* writeFiles(rootB, { "foo/SKILL.md": body });
          const skills = yield* scanSkills([rootA, rootB]);
          expect(skills).toHaveLength(1);
          // Later root still wins by location — preserves project-overrides-global precedence.
          expect(skills[0]?.location).toBe(path.join(rootB, "foo", "SKILL.md"));
          expect(warnSpy).not.toHaveBeenCalled();
        }),
      ),
    ),
  );

  it.effect("scans direct subdirs only — not <root>/SKILL.md or <root>/a/b/SKILL.md", () =>
    withTmpDir("skills", (dir) =>
      Effect.gen(function* () {
        // Decoys: a root-level SKILL.md and a nested one two levels deep.
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(dir, "SKILL.md"),
            "---\nname: root\ndescription: should not match\n---\nx",
          ),
        );
        yield* writeFiles(dir, {
          "ok/SKILL.md": "---\nname: ok\ndescription: ok\n---\nbody",
          "deep/inner/SKILL.md": "---\nname: deep\ndescription: should not match\n---\nx",
        });
        const skills = yield* scanSkills([dir]);
        expect(skills.map((s) => s.name)).toEqual(["ok"]);
      }),
    ),
  );

  it.effect("filters out skills shadowed by builtin slash commands", () =>
    withTmpDir("skills", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, {
          "clear/SKILL.md": "---\nname: clear\ndescription: shadowed by /clear\n---\nbody",
          "ok/SKILL.md": "---\nname: ok\ndescription: kept\n---\nbody",
        });
        const skills = yield* scanSkills([dir]);
        expect(skills.map((s) => s.name)).toEqual(["ok"]);
        // Warn cites the shadowed skill path and the builtin name.
        const warnCalls = warnSpy.mock.calls.flat().join(" ");
        expect(warnCalls).toMatch(/clear/);
        expect(warnCalls).toMatch(/builtin/);
      }),
    ),
  );
});
