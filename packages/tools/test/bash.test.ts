import { describe, expect, it } from "@effect/vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { ApprovalAutoApproveLayer, ApprovalDenyAllLayer } from "../src/approval-policy.ts";
import { bashHandler } from "../src/bash.ts";

describe("bashHandler", () => {
  it.effect("captures stdout for a successful command", () =>
    Effect.gen(function* () {
      const result = yield* bashHandler({ command: "echo hello" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
      expect(result.timedOut).toBe(false);
      expect(result.truncated).toBe(false);
    }).pipe(Effect.provide(ApprovalAutoApproveLayer), Effect.provide(NodeContext.layer)),
  );

  it.effect("captures non-zero exit code and stderr", () =>
    Effect.gen(function* () {
      const result = yield* bashHandler({ command: "echo oops 1>&2; exit 3" });
      expect(result.exitCode).toBe(3);
      expect(result.stderr.trim()).toBe("oops");
    }).pipe(Effect.provide(ApprovalAutoApproveLayer), Effect.provide(NodeContext.layer)),
  );

  // Uses live Clock so Effect.sleep advances in real time — TestClock would
  // block indefinitely while the OS process (real time) runs to completion.
  it.live("flags timeout when command exceeds timeoutMs", () =>
    Effect.gen(function* () {
      const result = yield* bashHandler({
        command: "sleep 2",
        timeoutMs: 100,
      });
      expect(result.timedOut).toBe(true);
    }).pipe(Effect.provide(ApprovalAutoApproveLayer), Effect.provide(NodeContext.layer)),
  );

  it.effect("scrubs env — DANGEROUS_SECRET is not visible to the child", () =>
    Effect.gen(function* () {
      process.env["DANGEROUS_SECRET"] = "exposed";
      const result = yield* bashHandler({ command: "echo ${DANGEROUS_SECRET:-clean}" });
      delete process.env["DANGEROUS_SECRET"];
      expect(result.stdout.trim()).toBe("clean");
    }).pipe(Effect.provide(ApprovalAutoApproveLayer), Effect.provide(NodeContext.layer)),
  );

  it.effect("truncates output past the 256 KiB cap", () =>
    Effect.gen(function* () {
      // 300_000 'a' chars > 256 KiB.
      const result = yield* bashHandler({
        command: "yes a | head -c 300000",
      });
      expect(result.truncated).toBe(true);
      expect(result.stdout.length).toBeLessThanOrEqual(256 * 1024);
    }).pipe(Effect.provide(ApprovalAutoApproveLayer), Effect.provide(NodeContext.layer)),
  );

  it.effect("fails with ApprovalDenied when the policy denies the request", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(bashHandler({ command: "echo nope" }));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ApprovalDenied");
      }
    }).pipe(Effect.provide(ApprovalDenyAllLayer), Effect.provide(NodeContext.layer)),
  );
});
