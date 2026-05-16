import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as path from "node:path";
import { loadAgentsFile } from "../src/agents-file.ts";
import { withTmpDir, writeFiles } from "./utilities.ts";

describe("loadAgentsFile", () => {
  it.effect("loads AGENTS.md from cwd when present", () =>
    withTmpDir("agents-file", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "AGENTS.md": "hello agents" });
        const result = yield* loadAgentsFile(dir);
        expect(result).toEqual({
          source: path.join(dir, "AGENTS.md"),
          content: "hello agents",
        });
      }),
    ),
  );

  it.effect("falls back to CLAUDE.md when AGENTS.md absent", () =>
    withTmpDir("agents-file", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "CLAUDE.md": "hello claude" });
        const result = yield* loadAgentsFile(dir);
        expect(result).toEqual({
          source: path.join(dir, "CLAUDE.md"),
          content: "hello claude",
        });
      }),
    ),
  );

  it.effect("AGENTS.md wins when both files exist", () =>
    withTmpDir("agents-file", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, {
          "AGENTS.md": "from agents",
          "CLAUDE.md": "from claude",
        });
        const result = yield* loadAgentsFile(dir);
        expect(result?.source).toBe(path.join(dir, "AGENTS.md"));
        expect(result?.content).toBe("from agents");
      }),
    ),
  );

  it.effect("returns undefined when neither file exists", () =>
    withTmpDir("agents-file", (dir) =>
      Effect.gen(function* () {
        const result = yield* loadAgentsFile(dir);
        expect(result).toBeUndefined();
      }),
    ),
  );

  it.effect("returns undefined when AGENTS.md is whitespace-only (no fallthrough)", () =>
    withTmpDir("agents-file", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, {
          "AGENTS.md": "   \n\n  \t\n",
          "CLAUDE.md": "would be picked up if we fell through",
        });
        const result = yield* loadAgentsFile(dir);
        expect(result).toBeUndefined();
      }),
    ),
  );

  it.effect("preserves the file content verbatim including leading/trailing whitespace", () =>
    withTmpDir("agents-file", (dir) =>
      Effect.gen(function* () {
        const body = "\n# Heading\n\n  - bullet with leading spaces\n```ts\nconst x = 1;\n```\n";
        yield* writeFiles(dir, { "AGENTS.md": body });
        const result = yield* loadAgentsFile(dir);
        expect(result?.content).toBe(body);
      }),
    ),
  );

  it.effect("source is absolute even when cwd is relative", () =>
    withTmpDir("agents-file", (dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "AGENTS.md": "x" });
        // path.relative returns a relative path from process.cwd() to dir.
        const relative = path.relative(process.cwd(), dir);
        const result = yield* loadAgentsFile(relative);
        expect(result?.source).toBeDefined();
        expect(path.isAbsolute(result!.source)).toBe(true);
      }),
    ),
  );
});
