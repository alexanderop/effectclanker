import { Tool } from "@effect/ai";
import { Command } from "@effect/platform";
import type { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Chunk, Duration, Effect, Fiber, Schema, Stream } from "effect";
import { ApprovalPolicy } from "./approval-policy.ts";
import { ShellError, ShellSpawnFailed } from "./errors.ts";
import { TruncationStore } from "./truncate.ts";

export const ShellResultSchema = Schema.Struct({
  stdout: Schema.String,
  stderr: Schema.String,
  exitCode: Schema.Number,
  timedOut: Schema.Boolean,
  truncated: Schema.Boolean,
  // Path to a tmp file holding the full pre-cap combined stdout+stderr when
  // `truncated` is true. `null` when no truncation happened, or when truncation
  // happened but the FS write failed (graceful degradation per ADR-0003).
  outputPath: Schema.NullOr(Schema.String),
});

export type ShellResult = typeof ShellResultSchema.Type;

// Tool name is `shell` (not `bash`) to avoid collision with Anthropic's
// provider-defined `bash` tool — `@effect/ai-anthropic` rewrites incoming
// `tool_use.name = "bash"` to `"AnthropicBash"` before the toolkit decodes
// the response, which would crash the stream against our toolkit's name
// union. See docs/patterns/effect-ai-gotchas.md §4.
export const ShellTool = Tool.make("shell", {
  description:
    "Run a shell command via `sh -c`. Captures stdout, stderr, exit code. Default timeout 10s, each stream capped at 50 KiB (tail direction — keeps the end where errors live). When truncated, `outputPath` names a tmp file with the full pre-cap stdout+stderr. Env is scrubbed to PATH/HOME/USER/LANG/LC_ALL/TERM.",
  parameters: {
    command: Schema.String,
    cwd: Schema.optional(Schema.String),
    timeoutMs: Schema.optional(Schema.Number),
  },
  success: ShellResultSchema,
  failure: ShellError,
  failureMode: "return",
});

export interface ShellParams {
  readonly command: string;
  readonly cwd?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 50 * 1024;
const ALLOWED_ENV_KEYS = new Set(["PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM"]);

// `@effect/platform-node`'s CommandExecutor merges `process.env` with our
// command.env (process.env wins on missing keys). To actually scrub the child's
// env we override every parent-leaked variable with an empty string while
// preserving the allow-list. The child sees PATH/HOME/USER/LANG/LC_ALL/TERM
// only; anything else is empty.
const buildScrubbedEnv = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of Object.keys(process.env)) {
    if (!ALLOWED_ENV_KEYS.has(key)) out[key] = "";
  }
  for (const key of ALLOWED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
};

// Collect the full byte stream. We retain everything (memory-bounded by what
// the child process actually emits, same as before) so that on truncation the
// full output can be persisted via TruncationStore. The capped slice for the
// model is computed at the end via a tail-direction `subarray`.
const captureStream = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<Buffer, E> =>
  Stream.runCollect(stream).pipe(
    Effect.map((chunks) =>
      Buffer.concat(Chunk.toReadonlyArray(chunks).map((chunk) => Buffer.from(chunk))),
    ),
  );

type RaceResult = { readonly kind: "exit"; readonly code: number } | { readonly kind: "timeout" };

// Decode bytes, taking the trailing `maxBytes` if the buffer is over cap.
// UTF-8 boundary safety: a multi-byte char split at the slice boundary decodes
// to U+FFFD via TextDecoder's default replacement. Acceptable for shell output.
const decodeTail = (buf: Buffer): { readonly text: string; readonly truncated: boolean } => {
  if (buf.length <= MAX_OUTPUT_BYTES) {
    return { text: new TextDecoder().decode(buf), truncated: false };
  }
  const tail = buf.subarray(buf.length - MAX_OUTPUT_BYTES);
  return { text: new TextDecoder().decode(tail), truncated: true };
};

export const shellHandler = ({
  command,
  cwd,
  timeoutMs,
}: ShellParams): Effect.Effect<
  ShellResult,
  ShellError,
  CommandExecutor | ApprovalPolicy | TruncationStore
> =>
  Effect.gen(function* () {
    const approval = yield* ApprovalPolicy;
    yield* approval.requireApproval({ kind: "shell", command, cwd });

    const timeout = Duration.millis(timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const env = buildScrubbedEnv();
    const cmd = Command.make("sh", "-c", command).pipe(
      Command.env(env),
      cwd === undefined ? (c) => c : Command.workingDirectory(cwd),
    );

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const process = yield* Command.start(cmd);
        const stdoutFiber = yield* Effect.fork(captureStream(process.stdout));
        const stderrFiber = yield* Effect.fork(captureStream(process.stderr));

        // Race the process's exit against a sleep. Whichever finishes first
        // interrupts the loser. On timeout we kill the process explicitly.
        const race: Effect.Effect<RaceResult, never, never> = Effect.race(
          process.exitCode.pipe(
            Effect.map((code): RaceResult => ({ kind: "exit", code })),
            Effect.orElseSucceed((): RaceResult => ({ kind: "exit", code: -1 })),
          ),
          Effect.sleep(timeout).pipe(Effect.as<RaceResult>({ kind: "timeout" })),
        );
        const outcome = yield* race;

        let timedOut = false;
        let exitCode: number;
        if (outcome.kind === "timeout") {
          timedOut = true;
          // Kill best-effort: a kill failure usually means the process is
          // already dead. Log instead of silently swallowing so signs of a
          // pid-leak still reach the operator.
          yield* process
            .kill("SIGTERM")
            .pipe(Effect.catchAll((e) => Effect.logDebug("SIGTERM failed", e)));
          exitCode = -1;
        } else {
          exitCode = outcome.code;
        }

        const stdoutFull = yield* Fiber.join(stdoutFiber);
        const stderrFull = yield* Fiber.join(stderrFiber);

        const stdoutDecoded = decodeTail(stdoutFull);
        const stderrDecoded = decodeTail(stderrFull);
        const truncated = stdoutDecoded.truncated || stderrDecoded.truncated;

        let outputPath: string | null = null;
        if (truncated) {
          const store = yield* TruncationStore;
          const combined = `${new TextDecoder().decode(stdoutFull)}\n--- STDERR ---\n${new TextDecoder().decode(stderrFull)}`;
          outputPath = yield* store.persist(combined);
        }

        return {
          stdout: stdoutDecoded.text,
          stderr: stderrDecoded.text,
          exitCode,
          timedOut,
          truncated,
          outputPath,
        };
      }),
    );
  }).pipe(
    Effect.catchTags({
      BadArgument: (e) => Effect.fail(new ShellSpawnFailed({ command, message: e.message })),
      SystemError: (e) => Effect.fail(new ShellSpawnFailed({ command, message: e.message })),
    }),
  );
