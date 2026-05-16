import { Tool } from "@effect/ai";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import * as path from "node:path";
import { GrepError, InvalidRegex } from "./errors.ts";
import {
  GREP_MAX_LINE_CHARS,
  GREP_MAX_MATCHES,
  truncateHead,
  truncateLine,
  type TruncationStore,
} from "./truncate.ts";

const formatSavedHint = (saved: string | null): string =>
  saved === null ? "" : ` Saved to ${saved} — read with offset/limit.`;

// Internal shape kept for the handler's local accumulator; not part of the
// model-facing schema since the success type became `Schema.String` to carry
// inline truncation hints.
export const GrepMatchSchema = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
  text: Schema.String,
});

export type GrepMatch = typeof GrepMatchSchema.Type;

export const GrepTool = Tool.make("grep", {
  description:
    "Search file contents by regex. Returns `file:line: text` matches as plain text. Skips dotfiles, node_modules, .git, dist, coverage. Capped at 100 matches and 50KB; long match lines truncated to 500 chars. When the cap fires, the full output is saved to a tmp file whose path is in the inline hint — read it with offset/limit.",
  parameters: {
    pattern: Schema.String,
    path: Schema.optional(Schema.String),
    caseInsensitive: Schema.optional(Schema.Boolean),
  },
  success: Schema.String,
  failure: GrepError,
  failureMode: "return",
});

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

export interface GrepParams {
  readonly pattern: string;
  readonly path?: string | undefined;
  readonly caseInsensitive?: boolean | undefined;
}

const walk = (
  fs: FileSystem.FileSystem,
  dir: string,
): Effect.Effect<ReadonlyArray<string>, never> =>
  fs.readDirectory(dir).pipe(
    Effect.catchAll((error) =>
      Effect.logDebug(`grep: skipped unreadable directory ${dir}: ${error.message}`).pipe(
        Effect.as<ReadonlyArray<string>>([]),
      ),
    ),
    Effect.flatMap((entries) =>
      Effect.forEach(entries, (name) => {
        if (name.startsWith(".") || SKIP_DIRS.has(name)) {
          return Effect.succeed<ReadonlyArray<string>>([]);
        }
        const full = path.join(dir, name);
        return fs.stat(full).pipe(
          Effect.flatMap((info) => {
            if (info.type === "Directory") return walk(fs, full);
            if (info.type === "File") return Effect.succeed<ReadonlyArray<string>>([full]);
            return Effect.succeed<ReadonlyArray<string>>([]);
          }),
          Effect.catchAll((error) =>
            Effect.logDebug(`grep: skipped ${full}: ${error.message}`).pipe(
              Effect.as<ReadonlyArray<string>>([]),
            ),
          ),
        );
      }),
    ),
    Effect.map((nested) => nested.flat()),
  );

export const grepHandler = ({
  caseInsensitive,
  path: searchPath,
  pattern,
}: GrepParams): Effect.Effect<string, GrepError, FileSystem.FileSystem | TruncationStore> =>
  Effect.gen(function* () {
    const flags = caseInsensitive ? "i" : "";
    const re = yield* Effect.try({
      try: () => new RegExp(pattern, flags),
      catch: (e) =>
        new InvalidRegex({ pattern, message: e instanceof Error ? e.message : String(e) }),
    });
    const fs = yield* FileSystem.FileSystem;
    const root = searchPath ?? ".";
    const files = yield* walk(fs, root);
    const matches: Array<GrepMatch> = [];
    let matchLimitHit = false;
    outer: for (const file of files) {
      const content = yield* fs
        .readFileString(file)
        .pipe(
          Effect.catchAll((error) =>
            Effect.logDebug(`grep: skipped unreadable file ${file}: ${error.message}`).pipe(
              Effect.as<string | null>(null),
            ),
          ),
        );
      if (content === null) continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (re.test(line)) {
          if (matches.length >= GREP_MAX_MATCHES) {
            matchLimitHit = true;
            break outer;
          }
          matches.push({ file, line: i + 1, text: line });
        }
      }
    }
    // Format matches as a plain-text body so the model parses the inline hint
    // alongside the results. Per-match line cap protects against pathological
    // single-line minified hits.
    const formatted = matches
      .map((m) => `${m.file}:${m.line}: ${truncateLine(m.text, GREP_MAX_LINE_CHARS).text}`)
      .join("\n");
    const result = yield* truncateHead(formatted);
    if (result.truncated) {
      const reason =
        result.truncatedBy === "lines"
          ? `Output capped at 2000 lines. Refine the pattern.`
          : `Output capped at 50KB. Refine the pattern.`;
      return `${result.content}\n\n[${reason}${formatSavedHint(result.outputPath)}]`;
    }
    if (matchLimitHit) {
      // Match-cap hit but the formatted text fit under byte/line caps — the
      // saved file isn't created (no truncation occurred). The hint still
      // tells the model the match list is partial.
      return `${result.content}\n\n[${GREP_MAX_MATCHES} matches limit reached. Refine the pattern.]`;
    }
    return result.content;
  });
