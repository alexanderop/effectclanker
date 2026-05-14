import { Terminal } from "@effect/platform";
import { ApprovalDenied, ApprovalPolicy, type ApprovalRequest } from "@effectclanker/tools";
import { Effect, Layer } from "effect";

const describeRequest = (request: ApprovalRequest): string => {
  switch (request.kind) {
    case "shell": {
      const where = request.cwd ? ` (cwd=${request.cwd})` : "";
      return `Run shell command${where}: ${request.command ?? ""}`;
    }
    case "write":
      return `Write file: ${request.path ?? ""}`;
    case "edit":
      return `Edit file: ${request.path ?? ""}`;
    case "apply_patch":
      return "Apply patch to one or more files";
  }
};

// Mirrors Codex's `AskForApproval::UnlessTrusted` — prompts the user on stdin
// before every gated action. Requires `Terminal` (provided by NodeContext).
export const ApprovalInteractiveLayer = Layer.effect(
  ApprovalPolicy,
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    return ApprovalPolicy.of({
      requireApproval: (request) =>
        Effect.gen(function* () {
          // A failed display means stderr is wedged; log and keep going so the
          // user still sees the readLine prompt below. Not silently swallowed:
          // the warning lands in the standard Effect log channel.
          yield* terminal
            .display(`\n[approval] ${describeRequest(request)}\n  approve? [y/N] `)
            .pipe(Effect.catchAll((e) => Effect.logWarning("approval prompt display failed", e)));
          const response = yield* terminal.readLine.pipe(Effect.catchAll(() => Effect.succeed("")));
          const normalized = response.trim().toLowerCase();
          if (normalized === "y" || normalized === "yes") {
            return;
          }
          return yield* Effect.fail(
            new ApprovalDenied({
              action: request.kind,
              reason: `user declined (replied "${response.trim()}")`,
            }),
          );
        }),
    });
  }),
);
