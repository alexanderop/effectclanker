import { describe, expect, it } from "vitest";
import type { SkillInfo } from "@effectclanker/harness";
import { BUILTINS } from "../src/builtin-commands.ts";
import { filterSlashCommands, listSlashCommands } from "../src/slash-commands.ts";

const skill = (name: string, description: string): SkillInfo => ({
  name,
  description,
  location: `/tmp/${name}/SKILL.md`,
  content: "body",
});

describe("listSlashCommands", () => {
  it("prefixes builtins then skills", () => {
    const out = listSlashCommands([skill("foo", "test")]);
    const builtinTriggers = BUILTINS.map((b) => `/${b.name}`);
    expect(out.slice(0, builtinTriggers.length).map((e) => e.trigger)).toEqual(builtinTriggers);
    expect(out[out.length - 1]?.trigger).toBe("/foo");
  });

  it("stamps source correctly", () => {
    const out = listSlashCommands([skill("foo", "test")]);
    const help = out.find((e) => e.trigger === "/help");
    const foo = out.find((e) => e.trigger === "/foo");
    expect(help?.source).toBe("builtin");
    expect(foo?.source).toBe("skill");
  });
});

describe("filterSlashCommands", () => {
  const entries = listSlashCommands([
    skill("grill-with-docs", "stress-test plans"),
    skill("prd", "Generate a PRD"),
  ]);

  it("returns [] for non-slash drafts", () => {
    expect(filterSlashCommands("hello", entries)).toEqual([]);
  });

  it("returns [] once a space appears", () => {
    expect(filterSlashCommands("/foo bar", entries)).toEqual([]);
  });

  it("prefix-matches trigger names", () => {
    const hMatches = filterSlashCommands("/h", entries);
    expect(hMatches.map((e) => e.trigger)).toEqual(["/help"]);
    const all = filterSlashCommands("/", entries);
    expect(all.map((e) => e.trigger)).toContain("/help");
    expect(all.map((e) => e.trigger)).toContain("/clear");
    expect(all.map((e) => e.trigger)).toContain("/grill-with-docs");
  });
});
