import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Queue } from "effect";
import { ApprovalPolicy } from "@effectclanker/tools";
import { ApprovalInk, ApprovalInkLayer } from "../src/approval-ink.ts";
import { expectLeft } from "./utilities.ts";

describe("ApprovalInkLayer", () => {
  it.effect("enqueues a request and resolves on Deferred.succeed(true)", () =>
    Effect.gen(function* () {
      const policy = yield* ApprovalPolicy;
      const ink = yield* ApprovalInk;

      const fiber = yield* Effect.fork(policy.requireApproval({ kind: "bash", command: "ls" }));

      const pending = yield* Queue.take(ink.requests);
      expect(pending.request.kind).toBe("bash");
      expect(pending.request.command).toBe("ls");

      yield* Deferred.succeed(pending.decision, true);
      const result = yield* Fiber.join(fiber);
      expect(result).toBeUndefined();
    }).pipe(Effect.provide(ApprovalInkLayer)),
  );

  it.effect("fails with ApprovalDenied on Deferred.succeed(false)", () =>
    Effect.gen(function* () {
      const policy = yield* ApprovalPolicy;
      const ink = yield* ApprovalInk;

      const fiber = yield* Effect.fork(policy.requireApproval({ kind: "write", path: "/tmp/x" }));
      const pending = yield* Queue.take(ink.requests);
      yield* Deferred.succeed(pending.decision, false);

      const result = yield* Effect.either(Fiber.join(fiber));
      const denial = expectLeft(result, "ApprovalDenied");
      expect((denial as { action: string }).action).toBe("write");
    }).pipe(Effect.provide(ApprovalInkLayer)),
  );
});
