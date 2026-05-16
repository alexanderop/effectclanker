import { Tool } from "@effect/ai";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import { FileError, mapFileError } from "./errors.ts";
import {
  READ_MAX_LINE_CHARS,
  truncateHead,
  truncateLine,
  type TruncationStore,
} from "./truncate.ts";

const formatSavedHint = (saved: string | null): string =>
  saved === null ? "" : ` Saved to ${saved} — grep or read with offset/limit.`;

export const ReadTool = Tool.make("read", {
  description:
    "Read a UTF-8 text file. Optional `offset` (0-based line) and `limit` (number of lines) slice the result. Output is capped at 50KB or 2000 lines (whichever hits first); long lines are truncated to 2000 chars. When capped, the full content is saved to a tmp file whose path is named in the inline hint — grep it or read it with offset/limit.",
  parameters: {
    path: Schema.String,
    offset: Schema.optional(Schema.Number),
    limit: Schema.optional(Schema.Number),
  },
  success: Schema.String,
  failure: FileError,
  failureMode: "return",
});

export interface ReadParams {
  readonly path: string;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
}

export const readHandler = ({
  limit,
  offset,
  path,
}: ReadParams): Effect.Effect<string, FileError, FileSystem.FileSystem | TruncationStore> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs.readFileString(path).pipe(Effect.mapError(mapFileError(path)));
    const allLines = content.split("\n");
    const start = offset ?? 0;
    const end = limit === undefined ? allLines.length : start + limit;
    const sliced = allLines.slice(start, end);
    // Per-line cap first, then byte/line truncation. Slicing+capping in this
    // order means a 200KB minified first line shrinks to 2000 chars before the
    // byte budget gets a chance to fire.
    const capped = sliced.map((line) => truncateLine(line, READ_MAX_LINE_CHARS).text);
    const text = capped.join("\n");
    const result = yield* truncateHead(text);
    if (!result.truncated) return result.content;
    const lastShownLineIdx = start + result.outputLines; // 0-indexed → next line to read
    const totalFileLines = allLines.length;
    const reasonHint =
      result.truncatedBy === "lines"
        ? `Showing lines ${start + 1}-${start + result.outputLines} of ${totalFileLines}. Use offset=${lastShownLineIdx} to continue.`
        : `Output capped at 50KB. Showing lines ${start + 1}-${start + result.outputLines} of ${totalFileLines}. Use offset=${lastShownLineIdx} to continue.`;
    return `${result.content}\n\n[${reasonHint}${formatSavedHint(result.outputPath)}]`;
  });
