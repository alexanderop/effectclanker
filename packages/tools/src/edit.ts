import { Tool } from "@effect/ai";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import { EditError, EditStringAmbiguous, EditStringNotFound, mapFileError } from "./errors.ts";

export const EditTool = Tool.make("edit", {
  description:
    "Exact-string replacement in a file. Fails if `oldString` is missing or appears more than once — add surrounding context to disambiguate.",
  parameters: {
    path: Schema.String,
    oldString: Schema.String,
    newString: Schema.String,
  },
  success: Schema.Struct({ replaced: Schema.Number }),
  failure: EditError,
  failureMode: "return",
});

export interface EditParams {
  readonly path: string;
  readonly oldString: string;
  readonly newString: string;
}

export const editHandler = ({
  newString,
  oldString,
  path,
}: EditParams): Effect.Effect<{ readonly replaced: number }, EditError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs.readFileString(path).pipe(Effect.mapError(mapFileError(path)));
    const idx = content.indexOf(oldString);
    if (idx === -1) {
      return yield* Effect.fail(new EditStringNotFound({ path }));
    }
    // Count occurrences without scanning the whole file twice.
    let occurrences = 1;
    let next = content.indexOf(oldString, idx + oldString.length);
    while (next !== -1) {
      occurrences++;
      next = content.indexOf(oldString, next + oldString.length);
    }
    if (occurrences > 1) {
      return yield* Effect.fail(new EditStringAmbiguous({ path, occurrences }));
    }
    const updated = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
    yield* fs.writeFileString(path, updated).pipe(Effect.mapError(mapFileError(path)));
    return { replaced: 1 };
  });
