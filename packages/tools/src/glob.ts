import { Tool } from "@effect/ai";
import { Effect, Schema } from "effect";
import * as fs from "node:fs/promises";
import { FileIOError, GlobError } from "./errors.ts";
import { GLOB_MAX_ENTRIES, truncateHead, type TruncationStore } from "./truncate.ts";

const formatSavedHint = (saved: string | null): string =>
  saved === null ? "" : ` Saved to ${saved} — read with offset/limit.`;

export const GlobTool = Tool.make("glob", {
  description:
    "Find paths matching a glob pattern (e.g. `**/*.ts`). Uses Node's built-in `fs.glob` (Node 22+). Returns one path per line; capped at 200 entries.",
  parameters: {
    pattern: Schema.String,
    cwd: Schema.optional(Schema.String),
  },
  success: Schema.String,
  failure: GlobError,
  failureMode: "return",
});

export interface GlobParams {
  readonly pattern: string;
  readonly cwd?: string | undefined;
}

interface GlobCollectResult {
  readonly entries: ReadonlyArray<string>;
  readonly entryLimitHit: boolean;
}

export const globHandler = ({
  cwd,
  pattern,
}: GlobParams): Effect.Effect<string, GlobError, TruncationStore> =>
  Effect.gen(function* () {
    const collected = yield* Effect.tryPromise({
      try: async (): Promise<GlobCollectResult> => {
        const entries: Array<string> = [];
        let entryLimitHit = false;
        const iter = fs.glob(pattern, { cwd });
        for await (const file of iter) {
          if (entries.length >= GLOB_MAX_ENTRIES) {
            entryLimitHit = true;
            break;
          }
          entries.push(file);
        }
        return { entries, entryLimitHit };
      },
      catch: (e) =>
        new FileIOError({
          path: cwd ?? ".",
          message: e instanceof Error ? e.message : String(e),
        }),
    });
    const body = collected.entries.join("\n");
    const result = yield* truncateHead(body);
    if (result.truncated) {
      const reason =
        result.truncatedBy === "lines"
          ? `Output capped at 2000 entries. Refine the pattern.`
          : `Output capped at 50KB. Refine the pattern.`;
      return `${result.content}\n\n[${reason}${formatSavedHint(result.outputPath)}]`;
    }
    if (collected.entryLimitHit) {
      return `${result.content}\n\n[Showing ${GLOB_MAX_ENTRIES} entries (more matches available). Refine the pattern.]`;
    }
    return result.content;
  });
