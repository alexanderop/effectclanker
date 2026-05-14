import type { PlatformError } from "@effect/platform/Error";
import { Schema } from "effect";

export class FileNotFound extends Schema.TaggedError<FileNotFound>()("FileNotFound", {
  path: Schema.String,
}) {}

export class FileAccessDenied extends Schema.TaggedError<FileAccessDenied>()("FileAccessDenied", {
  path: Schema.String,
}) {}

export class IsADirectory extends Schema.TaggedError<IsADirectory>()("IsADirectory", {
  path: Schema.String,
}) {}

export class FileIOError extends Schema.TaggedError<FileIOError>()("FileIOError", {
  path: Schema.String,
  message: Schema.String,
}) {}

export const FileError = Schema.Union(FileNotFound, FileAccessDenied, IsADirectory, FileIOError);
export type FileError = typeof FileError.Type;

export class EditStringNotFound extends Schema.TaggedError<EditStringNotFound>()(
  "EditStringNotFound",
  {
    path: Schema.String,
  },
) {}

export class EditStringAmbiguous extends Schema.TaggedError<EditStringAmbiguous>()(
  "EditStringAmbiguous",
  {
    path: Schema.String,
    occurrences: Schema.Number,
  },
) {}

export const EditError = Schema.Union(
  FileNotFound,
  FileAccessDenied,
  IsADirectory,
  FileIOError,
  EditStringNotFound,
  EditStringAmbiguous,
);
export type EditError = typeof EditError.Type;

export class InvalidRegex extends Schema.TaggedError<InvalidRegex>()("InvalidRegex", {
  pattern: Schema.String,
  message: Schema.String,
}) {}

export const GrepError = Schema.Union(
  InvalidRegex,
  FileNotFound,
  FileAccessDenied,
  IsADirectory,
  FileIOError,
);
export type GrepError = typeof GrepError.Type;

export const GlobError = Schema.Union(FileNotFound, FileAccessDenied, IsADirectory, FileIOError);
export type GlobError = typeof GlobError.Type;

export class BashSpawnFailed extends Schema.TaggedError<BashSpawnFailed>()("BashSpawnFailed", {
  command: Schema.String,
  message: Schema.String,
}) {}

export class ApprovalDenied extends Schema.TaggedError<ApprovalDenied>()("ApprovalDenied", {
  action: Schema.String,
  reason: Schema.String,
}) {}

export const BashError = Schema.Union(BashSpawnFailed, ApprovalDenied);
export type BashError = typeof BashError.Type;

export class ApplyPatchParseError extends Schema.TaggedError<ApplyPatchParseError>()(
  "ApplyPatchParseError",
  {
    line: Schema.Number,
    message: Schema.String,
  },
) {}

export class ApplyPatchHunkFailed extends Schema.TaggedError<ApplyPatchHunkFailed>()(
  "ApplyPatchHunkFailed",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export const ApplyPatchError = Schema.Union(
  ApplyPatchParseError,
  ApplyPatchHunkFailed,
  FileNotFound,
  FileAccessDenied,
  IsADirectory,
  FileIOError,
);
export type ApplyPatchError = typeof ApplyPatchError.Type;

// Convert a PlatformError from FileSystem operations into a domain-typed FileError.
// `SystemError.reason` carries the structured outcome (NotFound, PermissionDenied, …)
// so callers can `catchTag` instead of substring-matching error messages.
export const mapFileError =
  (path: string) =>
  (e: PlatformError): FileError => {
    if (e._tag === "BadArgument") {
      return new FileIOError({ path, message: e.message });
    }
    switch (e.reason) {
      case "NotFound":
        return new FileNotFound({ path });
      case "PermissionDenied":
        return new FileAccessDenied({ path });
      default:
        return new FileIOError({ path, message: e.message });
    }
  };
