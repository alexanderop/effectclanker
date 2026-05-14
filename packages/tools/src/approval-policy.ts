import { Context, Effect, Layer } from "effect";
import { ApprovalDenied } from "./errors.ts";

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
