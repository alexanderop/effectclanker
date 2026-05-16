import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface AgentsFileInfo {
  readonly source: string;
  readonly content: string;
}

// AGENTS.md is the open-standard filename (agents.md); CLAUDE.md is the
// Anthropic-specific fallback. AGENTS.md wins when both exist; we do not
// stack them. See docs/adr/0004-agents-file-discovery-is-cwd-only.md.
const CANDIDATES = ["AGENTS.md", "CLAUDE.md"] as const;

const tryReadFile = (filePath: string): Effect.Effect<string | undefined, Error> =>
  Effect.tryPromise({
    try: async () => {
      try {
        return await fs.readFile(filePath, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
    },
    catch: (err) => err as Error,
  });

export const loadAgentsFile = (cwd: string): Effect.Effect<AgentsFileInfo | undefined, Error> =>
  Effect.gen(function* () {
    for (const name of CANDIDATES) {
      const source = path.resolve(cwd, name);
      const content = yield* tryReadFile(source);
      if (content === undefined) continue;
      // Existing-but-empty signals user intent to silence the file. Do not
      // fall through to the next candidate — see specs/pending/agents-file.md
      // "Out of scope: Whitespace-only file → CLAUDE.md fallback".
      if (content.trim().length === 0) return undefined;
      return { source, content };
    }
    return undefined;
  });
