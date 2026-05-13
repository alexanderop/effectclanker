import { Terminal } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import { ApprovalDenied } from "../tools/errors.ts";

export interface ApprovalRequest {
  readonly kind: "bash" | "write" | "edit" | "apply_patch";
  readonly command?: string | undefined;
  readonly cwd?: string | undefined;
  readonly path?: string | undefined;
}

export interface ApprovalPolicyService {
  readonly requireApproval: (request: ApprovalRequest) => Effect.Effect<void, ApprovalDenied>;
}

export class ApprovalPolicy extends Context.Tag("ApprovalPolicy")<
  ApprovalPolicy,
  ApprovalPolicyService
>() {}

// Mirrors Codex's `AskForApproval::Never` — auto-approves every request without
// prompting. Sensible for tests and trusted automation.
export const ApprovalAutoApproveLayer = Layer.succeed(ApprovalPolicy, {
  requireApproval: () => Effect.void,
});

// Mirrors Codex's deny-by-default mode used in sandbox tests.
export const ApprovalDenyAllLayer = Layer.succeed(ApprovalPolicy, {
  requireApproval: (request) =>
    Effect.fail(
      new ApprovalDenied({
        action: request.kind,
        reason: "approval policy denies all gated actions",
      }),
    ),
});

const describeRequest = (request: ApprovalRequest): string => {
  switch (request.kind) {
    case "bash": {
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
          yield* terminal
            .display(`\n[approval] ${describeRequest(request)}\n  approve? [y/N] `)
            .pipe(Effect.ignore);
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
