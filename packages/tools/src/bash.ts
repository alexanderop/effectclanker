import { Tool } from "@effect/ai";
import { Command } from "@effect/platform";
import type { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Duration, Effect, Fiber, Schema, Stream } from "effect";
import { ApprovalPolicy } from "./approval-policy.ts";
import { BashError, BashSpawnFailed } from "./errors.ts";

export const BashResultSchema = Schema.Struct({
  stdout: Schema.String,
  stderr: Schema.String,
  exitCode: Schema.Number,
  timedOut: Schema.Boolean,
  truncated: Schema.Boolean,
});

export type BashResult = typeof BashResultSchema.Type;

export const BashTool = Tool.make("bash", {
  description:
    "Run a shell command via `sh -c`. Captures stdout, stderr, exit code. Default timeout 10s, output capped at 256 KiB. Env is scrubbed to PATH/HOME/USER/LANG/LC_ALL/TERM.",
  parameters: {
    command: Schema.String,
    cwd: Schema.optional(Schema.String),
    timeoutMs: Schema.optional(Schema.Number),
  },
  success: BashResultSchema,
  failure: BashError,
  failureMode: "return",
});

export interface BashParams {
  readonly command: string;
  readonly cwd?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
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

interface CaptureState {
  readonly buf: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

const captureStream = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<CaptureState, E> =>
  Stream.runFold(stream, { buf: "", bytes: 0, truncated: false } as CaptureState, (acc, chunk) => {
    if (acc.bytes >= MAX_OUTPUT_BYTES) return { ...acc, truncated: true };
    const remaining = MAX_OUTPUT_BYTES - acc.bytes;
    const take = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    const text = new TextDecoder().decode(take);
    return {
      buf: acc.buf + text,
      bytes: acc.bytes + take.length,
      truncated: acc.truncated || chunk.length > remaining,
    };
  });

type RaceResult = { readonly kind: "exit"; readonly code: number } | { readonly kind: "timeout" };

export const bashHandler = ({
  command,
  cwd,
  timeoutMs,
}: BashParams): Effect.Effect<BashResult, BashError, CommandExecutor | ApprovalPolicy> =>
  Effect.gen(function* () {
    const approval = yield* ApprovalPolicy;
    yield* approval.requireApproval({ kind: "bash", command, cwd });

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

        const stdoutState = yield* Fiber.join(stdoutFiber);
        const stderrState = yield* Fiber.join(stderrFiber);

        return {
          stdout: stdoutState.buf,
          stderr: stderrState.buf,
          exitCode,
          timedOut,
          truncated: stdoutState.truncated || stderrState.truncated,
        };
      }),
    );
  }).pipe(
    Effect.catchTags({
      BadArgument: (e) => Effect.fail(new BashSpawnFailed({ command, message: e.message })),
      SystemError: (e) => Effect.fail(new BashSpawnFailed({ command, message: e.message })),
    }),
  );
