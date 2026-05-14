import { Tool } from "@effect/ai";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import * as path from "node:path";
import {
  ApplyPatchError,
  ApplyPatchHunkFailed,
  ApplyPatchParseError,
  mapFileError,
} from "./errors.ts";

export const ApplyPatchTool = Tool.make("apply_patch", {
  description: `Apply a structured patch to one or more files. Patch envelope mirrors OpenAI Codex's apply_patch grammar:

*** Begin Patch
*** Add File: path/to/new.ts
+line one
+line two
*** Update File: path/to/existing.ts
[*** Move to: path/to/renamed.ts]
@@ optional header
 context line
-old line
+new line
 context line
*** Delete File: path/to/old.ts
*** End Patch

Each Update hunk must include enough context lines (prefixed with a single space) to uniquely locate the change. New file contents are prefixed with '+'. Paths must be relative.`,
  parameters: {
    patch: Schema.String,
  },
  success: Schema.Struct({
    added: Schema.Array(Schema.String),
    deleted: Schema.Array(Schema.String),
    updated: Schema.Array(Schema.String),
    moved: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String })),
  }),
  failure: ApplyPatchError,
  failureMode: "return",
});

export interface ApplyPatchParams {
  readonly patch: string;
}

interface HunkLine {
  readonly tag: " " | "-" | "+";
  readonly text: string;
}

interface Hunk {
  readonly header: string | undefined;
  readonly lines: ReadonlyArray<HunkLine>;
  readonly endOfFile: boolean;
}

type FileOp =
  | { readonly kind: "add"; readonly path: string; readonly lines: ReadonlyArray<string> }
  | { readonly kind: "delete"; readonly path: string }
  | {
      readonly kind: "update";
      readonly path: string;
      readonly moveTo: string | undefined;
      readonly hunks: ReadonlyArray<Hunk>;
    };

const BEGIN = "*** Begin Patch";
const END = "*** End Patch";
const ADD = "*** Add File: ";
const DELETE = "*** Delete File: ";
const UPDATE = "*** Update File: ";
const MOVE = "*** Move to: ";
const END_OF_FILE = "*** End of File";

interface ApplyPatchSummary {
  readonly added: ReadonlyArray<string>;
  readonly deleted: ReadonlyArray<string>;
  readonly updated: ReadonlyArray<string>;
  readonly moved: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

const parsePatch = (source: string): Effect.Effect<ReadonlyArray<FileOp>, ApplyPatchParseError> =>
  Effect.sync(() => {
    // Normalise CRLF and strip a single trailing newline so the last marker is
    // still recognised even when the model omits the terminating LF.
    const rawLines = source.replace(/\r\n/g, "\n").split("\n");
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") rawLines.pop();
    return rawLines;
  }).pipe(
    Effect.flatMap((lines) =>
      Effect.gen(function* () {
        let i = 0;
        if (lines[0] !== BEGIN) {
          return yield* Effect.fail(
            new ApplyPatchParseError({ line: 1, message: `expected '${BEGIN}'` }),
          );
        }
        i++;

        const ops: Array<FileOp> = [];

        while (i < lines.length) {
          const line = lines[i] ?? "";
          if (line === END) {
            i++;
            if (i !== lines.length) {
              return yield* Effect.fail(
                new ApplyPatchParseError({
                  line: i + 1,
                  message: `extra content after '${END}'`,
                }),
              );
            }
            return ops;
          }

          if (line.startsWith(ADD)) {
            const filePath = line.slice(ADD.length).trim();
            i++;
            const contentLines: Array<string> = [];
            while (i < lines.length && !(lines[i] ?? "").startsWith("*** ")) {
              const l = lines[i] ?? "";
              if (!l.startsWith("+")) {
                return yield* Effect.fail(
                  new ApplyPatchParseError({
                    line: i + 1,
                    message: `Add File body lines must start with '+', got '${l}'`,
                  }),
                );
              }
              contentLines.push(l.slice(1));
              i++;
            }
            ops.push({ kind: "add", path: filePath, lines: contentLines });
            continue;
          }

          if (line.startsWith(DELETE)) {
            ops.push({ kind: "delete", path: line.slice(DELETE.length).trim() });
            i++;
            continue;
          }

          if (line.startsWith(UPDATE)) {
            const filePath = line.slice(UPDATE.length).trim();
            i++;
            let moveTo: string | undefined;
            if (i < lines.length && (lines[i] ?? "").startsWith(MOVE)) {
              moveTo = (lines[i] ?? "").slice(MOVE.length).trim();
              i++;
            }
            const hunks: Array<Hunk> = [];
            while (i < lines.length && (lines[i] ?? "").startsWith("@@")) {
              const header = (lines[i] ?? "").slice(2).trim();
              i++;
              const hunkLines: Array<HunkLine> = [];
              let endOfFile = false;
              while (i < lines.length) {
                const hl = lines[i] ?? "";
                if (hl.startsWith("*** ")) {
                  if (hl === END_OF_FILE) {
                    endOfFile = true;
                    i++;
                  }
                  break;
                }
                // A fresh `@@` line starts the next hunk in the same Update
                // File block; let the outer loop pick it up.
                if (hl.startsWith("@@")) break;
                // Hunk lines must start with ' ', '-', or '+'. Empty lines (no
                // leading char) are tolerated as blank-context lines.
                if (hl.length === 0) {
                  hunkLines.push({ tag: " ", text: "" });
                  i++;
                  continue;
                }
                const tag = hl.charAt(0);
                if (tag !== " " && tag !== "-" && tag !== "+") {
                  return yield* Effect.fail(
                    new ApplyPatchParseError({
                      line: i + 1,
                      message: `hunk lines must start with ' ', '-', or '+', got '${hl}'`,
                    }),
                  );
                }
                hunkLines.push({ tag, text: hl.slice(1) });
                i++;
              }
              hunks.push({
                header: header.length === 0 ? undefined : header,
                lines: hunkLines,
                endOfFile,
              });
            }
            ops.push({ kind: "update", path: filePath, moveTo, hunks });
            continue;
          }

          return yield* Effect.fail(
            new ApplyPatchParseError({
              line: i + 1,
              message: `unexpected directive '${line}'`,
            }),
          );
        }

        return yield* Effect.fail(
          new ApplyPatchParseError({ line: i + 1, message: `missing '${END}'` }),
        );
      }),
    ),
  );

const applyHunkToLines = (
  filePath: string,
  hunk: Hunk,
  fileLines: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, ApplyPatchHunkFailed> =>
  Effect.sync(() => {
    const fromLines: Array<string> = [];
    const toLines: Array<string> = [];
    for (const line of hunk.lines) {
      if (line.tag === " ") {
        fromLines.push(line.text);
        toLines.push(line.text);
      } else if (line.tag === "-") {
        fromLines.push(line.text);
      } else {
        toLines.push(line.text);
      }
    }

    let searchStart = 0;
    if (hunk.header !== undefined) {
      const headerIdx = fileLines.findIndex((l) => l.includes(hunk.header ?? ""));
      if (headerIdx === -1) {
        return {
          ok: false as const,
          message: `header '@@ ${hunk.header}' not found in ${filePath}`,
        };
      }
      searchStart = headerIdx + 1;
    }

    // Find the unique location matching all of fromLines.
    let matchIdx = -1;
    let matchCount = 0;
    if (fromLines.length === 0) {
      // Pure-insert hunk with no context. Apply at end of file (or after header).
      matchIdx = hunk.endOfFile || hunk.header === undefined ? fileLines.length : searchStart;
      matchCount = 1;
    } else {
      for (let i = searchStart; i + fromLines.length <= fileLines.length; i++) {
        let ok = true;
        for (let j = 0; j < fromLines.length; j++) {
          if (fileLines[i + j] !== fromLines[j]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          matchCount++;
          if (matchIdx === -1) matchIdx = i;
          if (matchCount > 1) break;
        }
      }
    }

    if (matchIdx === -1) {
      return {
        ok: false as const,
        message: `hunk context not found in ${filePath} (looking for ${fromLines.length} lines)`,
      };
    }
    if (matchCount > 1) {
      return {
        ok: false as const,
        message: `hunk context matches ${matchCount} locations in ${filePath} — add more context or a @@ header`,
      };
    }

    const next = [
      ...fileLines.slice(0, matchIdx),
      ...toLines,
      ...fileLines.slice(matchIdx + fromLines.length),
    ];
    return { ok: true as const, lines: next };
  }).pipe(
    Effect.flatMap((result) =>
      result.ok
        ? Effect.succeed(result.lines)
        : Effect.fail(new ApplyPatchHunkFailed({ path: filePath, message: result.message })),
    ),
  );

const applyOp = (
  fs: FileSystem.FileSystem,
  op: FileOp,
  summary: {
    added: Array<string>;
    deleted: Array<string>;
    updated: Array<string>;
    moved: Array<{ from: string; to: string }>;
  },
): Effect.Effect<void, ApplyPatchError> => {
  switch (op.kind) {
    case "add": {
      const content = op.lines.join("\n") + (op.lines.length > 0 ? "\n" : "");
      return Effect.gen(function* () {
        const parent = path.dirname(op.path);
        if (parent && parent !== "." && parent !== "/") {
          yield* fs
            .makeDirectory(parent, { recursive: true })
            .pipe(Effect.mapError(mapFileError(parent)));
        }
        yield* fs.writeFileString(op.path, content).pipe(Effect.mapError(mapFileError(op.path)));
        summary.added.push(op.path);
      });
    }
    case "delete":
      return fs.remove(op.path).pipe(
        Effect.mapError(mapFileError(op.path)),
        Effect.tap(() => Effect.sync(() => summary.deleted.push(op.path))),
      );
    case "update":
      return Effect.gen(function* () {
        const original = yield* fs
          .readFileString(op.path)
          .pipe(Effect.mapError(mapFileError(op.path)));
        let lines = original.split("\n");
        // readFileString preserves a trailing newline as a final empty element; track it.
        const hadTrailingNewline = original.endsWith("\n");
        if (hadTrailingNewline) lines.pop();
        for (const hunk of op.hunks) {
          lines = [...(yield* applyHunkToLines(op.path, hunk, lines))];
        }
        const next = lines.join("\n") + (hadTrailingNewline ? "\n" : "");
        const targetPath = op.moveTo ?? op.path;
        if (op.moveTo !== undefined && op.moveTo !== op.path) {
          const parent = path.dirname(op.moveTo);
          if (parent && parent !== "." && parent !== "/") {
            yield* fs
              .makeDirectory(parent, { recursive: true })
              .pipe(Effect.mapError(mapFileError(parent)));
          }
          yield* fs.remove(op.path).pipe(Effect.mapError(mapFileError(op.path)));
          summary.moved.push({ from: op.path, to: op.moveTo });
        }
        yield* fs.writeFileString(targetPath, next).pipe(Effect.mapError(mapFileError(targetPath)));
        summary.updated.push(targetPath);
      });
  }
};

export const applyPatchHandler = ({
  patch,
}: ApplyPatchParams): Effect.Effect<ApplyPatchSummary, ApplyPatchError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const ops = yield* parsePatch(patch);
    const fs = yield* FileSystem.FileSystem;
    const summary = {
      added: [] as Array<string>,
      deleted: [] as Array<string>,
      updated: [] as Array<string>,
      moved: [] as Array<{ from: string; to: string }>,
    };
    for (const op of ops) {
      yield* applyOp(fs, op, summary);
    }
    return summary;
  });
