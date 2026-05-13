import { Tool } from "@effect/ai";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import * as path from "node:path";
import { GrepError, InvalidRegex } from "./errors.ts";

export const GrepMatchSchema = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
  text: Schema.String,
});

export type GrepMatch = typeof GrepMatchSchema.Type;

export const GrepTool = Tool.make("grep", {
  description:
    "Search file contents by regex. Returns matches as {file, line, text}. Skips dotfiles, node_modules, .git, dist, coverage.",
  parameters: {
    pattern: Schema.String,
    path: Schema.optional(Schema.String),
    caseInsensitive: Schema.optional(Schema.Boolean),
  },
  success: Schema.Array(GrepMatchSchema),
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
}: GrepParams): Effect.Effect<ReadonlyArray<GrepMatch>, GrepError, FileSystem.FileSystem> =>
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
    for (const file of files) {
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
          matches.push({ file, line: i + 1, text: line });
        }
      }
    }
    return matches;
  });
