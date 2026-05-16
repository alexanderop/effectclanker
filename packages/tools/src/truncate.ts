import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import * as path from "node:path";

// Cap defaults shared across read/grep/glob/shell. Numbers are calibrated for
// Anthropic's 50k ITPM regime: 50 KB ≈ 12.5k input tokens, so three accumulated
// Tool outputs plus the system prompt fit a single round under the cap. See
// docs/adr/0003-persist-truncated-tool-outputs.md.
export const MAX_LINES = 2000;
export const MAX_BYTES = 50 * 1024;
export const READ_MAX_LINE_CHARS = 2000;
export const GREP_MAX_LINE_CHARS = 500;
export const GLOB_MAX_ENTRIES = 200;
export const GREP_MAX_MATCHES = 100;

// Three-state discriminated result. The truncated branch is split by
// outputPath presence so the FS-write failure path (graceful degradation per
// docs/patterns/effect-ai-gotchas.md §1) is encoded in the type.
export type TruncationResult =
  | {
      readonly truncated: false;
      readonly content: string;
      readonly outputLines: number;
      readonly outputBytes: number;
    }
  | {
      readonly truncated: true;
      readonly content: string;
      readonly outputLines: number;
      readonly outputBytes: number;
      readonly totalLines: number;
      readonly totalBytes: number;
      readonly truncatedBy: "lines" | "bytes";
      readonly outputPath: string;
    }
  | {
      readonly truncated: true;
      readonly content: string;
      readonly outputLines: number;
      readonly outputBytes: number;
      readonly totalLines: number;
      readonly totalBytes: number;
      readonly truncatedBy: "lines" | "bytes";
      readonly outputPath: null;
    };

export interface TruncateOptions {
  readonly maxLines?: number;
  readonly maxBytes?: number;
}

export interface TruncationStoreService {
  // Returns the absolute path of the written file, or null when persistence
  // failed (disk full, permissions, dir removed mid-flight). Callers degrade
  // to inline-only truncation in the null case.
  readonly persist: (text: string) => Effect.Effect<string | null>;
}

export class TruncationStore extends Context.Tag("@effectclanker/TruncationStore")<
  TruncationStore,
  TruncationStoreService
>() {}

const byteLength = (s: string): number => Buffer.byteLength(s, "utf-8");

interface CollectHeadResult {
  readonly lines: ReadonlyArray<string>;
  readonly bytes: number;
  readonly hitBytes: boolean;
}

const collectHead = (
  lines: ReadonlyArray<string>,
  maxLines: number,
  maxBytes: number,
): CollectHeadResult => {
  const out: Array<string> = [];
  let bytes = 0;
  let hitBytes = false;
  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const line = lines[i] ?? "";
    const size = byteLength(line) + (i > 0 ? 1 : 0);
    if (bytes + size > maxBytes) {
      hitBytes = true;
      break;
    }
    out.push(line);
    bytes += size;
  }
  return { lines: out, bytes, hitBytes };
};

const collectTail = (
  lines: ReadonlyArray<string>,
  maxLines: number,
  maxBytes: number,
): CollectHeadResult => {
  const out: Array<string> = [];
  let bytes = 0;
  let hitBytes = false;
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const line = lines[i] ?? "";
    const size = byteLength(line) + (out.length > 0 ? 1 : 0);
    if (bytes + size > maxBytes) {
      hitBytes = true;
      break;
    }
    out.unshift(line);
    bytes += size;
  }
  return { lines: out, bytes, hitBytes };
};

const truncate = (
  direction: "head" | "tail",
  text: string,
  options: TruncateOptions = {},
): Effect.Effect<TruncationResult, never, TruncationStore> =>
  Effect.gen(function* () {
    const maxLines = options.maxLines ?? MAX_LINES;
    const maxBytes = options.maxBytes ?? MAX_BYTES;
    const totalBytes = byteLength(text);
    const lines = text.split("\n");
    const totalLines = lines.length;

    if (totalLines <= maxLines && totalBytes <= maxBytes) {
      return {
        truncated: false,
        content: text,
        outputLines: totalLines,
        outputBytes: totalBytes,
      } as const;
    }

    const collected =
      direction === "head"
        ? collectHead(lines, maxLines, maxBytes)
        : collectTail(lines, maxLines, maxBytes);
    const content = collected.lines.join("\n");
    const truncatedBy: "lines" | "bytes" = collected.hitBytes ? "bytes" : "lines";
    const store = yield* TruncationStore;
    const outputPath = yield* store.persist(text);
    const base = {
      truncated: true,
      content,
      outputLines: collected.lines.length,
      outputBytes: byteLength(content),
      totalLines,
      totalBytes,
      truncatedBy,
    } as const;
    return outputPath === null
      ? ({ ...base, outputPath: null } as const)
      : ({ ...base, outputPath } as const);
  });

export const truncateHead = (
  text: string,
  options?: TruncateOptions,
): Effect.Effect<TruncationResult, never, TruncationStore> => truncate("head", text, options);

export const truncateTail = (
  text: string,
  options?: TruncateOptions,
): Effect.Effect<TruncationResult, never, TruncationStore> => truncate("tail", text, options);

// Sync per-line truncator. Used by grep on each match's text and by read on
// individual file lines. Suffix matches pi's convention for visibility.
export const truncateLine = (
  line: string,
  maxChars: number,
): { readonly text: string; readonly wasTruncated: boolean } => {
  if (line.length <= maxChars) return { text: line, wasTruncated: false };
  return {
    text: `${line.slice(0, maxChars)}... [line truncated to ${maxChars} chars]`,
    wasTruncated: true,
  };
};

// Per-session tmpdir layer. Created on layer build via
// `makeTempDirectoryScoped` so cleanup is automatic when the harness's root
// Scope closes (CLI runCommand exit, TUI session exit). FS write failure in
// `persist` is swallowed and logged — the calling tool degrades to
// inline-only truncation per ADR-0003.
export const TruncationStoreLive: Layer.Layer<TruncationStore, never, FileSystem.FileSystem> =
  Layer.scoped(
    TruncationStore,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs
        .makeTempDirectoryScoped({ prefix: "effectclanker-" })
        .pipe(Effect.orDie);
      let counter = 0;
      const persist = (text: string): Effect.Effect<string | null> =>
        Effect.gen(function* () {
          counter += 1;
          const file = path.join(dir, `tool_${counter.toString().padStart(6, "0")}.txt`);
          return yield* fs.writeFileString(file, text).pipe(
            Effect.map(() => file as string | null),
            Effect.catchAll((error) =>
              Effect.logDebug(`truncate: persist failed for ${file}: ${error.message}`).pipe(
                Effect.as<string | null>(null),
              ),
            ),
          );
        });
      return { persist };
    }),
  );
