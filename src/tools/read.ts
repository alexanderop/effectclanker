import { Tool } from "@effect/ai";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import { FileError, mapFileError } from "./errors.ts";

export const ReadTool = Tool.make("read", {
  description:
    "Read a UTF-8 text file. Optional `offset` (0-based line) and `limit` (number of lines) slice the result.",
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
}: ReadParams): Effect.Effect<string, FileError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs.readFileString(path).pipe(Effect.mapError(mapFileError(path)));
    if (offset === undefined && limit === undefined) return content;
    const lines = content.split("\n");
    const start = offset ?? 0;
    const end = limit === undefined ? lines.length : start + limit;
    return lines.slice(start, end).join("\n");
  });
