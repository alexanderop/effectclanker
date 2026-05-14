import { Tool } from "@effect/ai";
import { Effect, Schema } from "effect";
import * as fs from "node:fs/promises";
import { FileIOError, GlobError } from "./errors.ts";

export const GlobTool = Tool.make("glob", {
  description:
    "Find paths matching a glob pattern (e.g. `**/*.ts`). Uses Node's built-in `fs.glob` (Node 22+).",
  parameters: {
    pattern: Schema.String,
    cwd: Schema.optional(Schema.String),
  },
  success: Schema.Array(Schema.String),
  failure: GlobError,
  failureMode: "return",
});

export interface GlobParams {
  readonly pattern: string;
  readonly cwd?: string | undefined;
}

export const globHandler = ({
  cwd,
  pattern,
}: GlobParams): Effect.Effect<ReadonlyArray<string>, GlobError> =>
  Effect.tryPromise({
    try: async () => {
      const matches: Array<string> = [];
      const iter = fs.glob(pattern, { cwd });
      for await (const file of iter) {
        matches.push(file);
      }
      return matches;
    },
    catch: (e) =>
      new FileIOError({
        path: cwd ?? ".",
        message: e instanceof Error ? e.message : String(e),
      }),
  });
