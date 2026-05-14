import { Tool } from "@effect/ai";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import * as path from "node:path";
import { FileError, mapFileError } from "./errors.ts";

export const WriteTool = Tool.make("write", {
  description: "Write UTF-8 content to a file (overwrites). Creates parent directories as needed.",
  parameters: {
    path: Schema.String,
    content: Schema.String,
  },
  success: Schema.Struct({ bytesWritten: Schema.Number }),
  failure: FileError,
  failureMode: "return",
});

export interface WriteParams {
  readonly path: string;
  readonly content: string;
}

export const writeHandler = ({
  content,
  path: filePath,
}: WriteParams): Effect.Effect<
  { readonly bytesWritten: number },
  FileError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const parent = path.dirname(filePath);
    yield* fs
      .makeDirectory(parent, { recursive: true })
      .pipe(Effect.mapError(mapFileError(parent)));
    yield* fs.writeFileString(filePath, content).pipe(Effect.mapError(mapFileError(filePath)));
    return { bytesWritten: Buffer.byteLength(content, "utf8") };
  });
