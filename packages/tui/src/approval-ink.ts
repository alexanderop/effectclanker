import {
  ApprovalAutoApproveLayer,
  ApprovalDenied,
  ApprovalDenyAllLayer,
  ApprovalPolicy,
  type ApprovalRequest,
} from "@effectclanker/tools";
import { Context, Deferred, Effect, Layer, Queue } from "effect";

// Pending approval request awaiting a UI decision. The UI takes one off
// `requests`, renders a modal, and completes the `decision` Deferred with
// `true` (approve) or `false` (deny).
export interface PendingApproval {
  readonly request: ApprovalRequest;
  readonly decision: Deferred.Deferred<boolean>;
}

export interface ApprovalInkBridge {
  readonly requests: Queue.Dequeue<PendingApproval>;
}

export class ApprovalInk extends Context.Tag("ApprovalInk")<ApprovalInk, ApprovalInkBridge>() {}

// Used by the Ink chat runtime so the renderer's code can always
// `yield* ApprovalInk` regardless of approval mode. Auto and deny modes route
// every request through their own ApprovalPolicy and never offer to this
// queue, so taking from it parks forever — the UI's listener fiber is
// effectively idle.
const NoOpApprovalInkLayer = Layer.scopedContext(
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<PendingApproval>();
    yield* Effect.addFinalizer(() => Queue.shutdown(queue));
    return Context.empty().pipe(Context.add(ApprovalInk, ApprovalInk.of({ requests: queue })));
  }),
);

export const ApprovalAutoApproveInkLayer = Layer.mergeAll(
  ApprovalAutoApproveLayer,
  NoOpApprovalInkLayer,
);

export const ApprovalDenyAllInkLayer = Layer.mergeAll(ApprovalDenyAllLayer, NoOpApprovalInkLayer);

// Approval policy that surfaces requests as items on a shared Queue the Ink
// UI subscribes to via the `ApprovalInk` tag. `requireApproval` enqueues a
// request together with a `Deferred<boolean>` and awaits the UI's reply. A
// `false` decision fails with the same `ApprovalDenied` tagged error the
// other policies use, so handler-side logic is identical.
export const ApprovalInkLayer = Layer.scopedContext(
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<PendingApproval>();
    yield* Effect.addFinalizer(() => Queue.shutdown(queue));
    return Context.empty().pipe(
      Context.add(
        ApprovalPolicy,
        ApprovalPolicy.of({
          requireApproval: (request) =>
            Effect.gen(function* () {
              const decision = yield* Deferred.make<boolean>();
              yield* Queue.offer(queue, { request, decision });
              const approved = yield* Deferred.await(decision);
              if (approved) {
                return;
              }
              return yield* Effect.fail(
                new ApprovalDenied({
                  action: request.kind,
                  reason: "user denied via Ink approval modal",
                }),
              );
            }),
        }),
      ),
      Context.add(ApprovalInk, ApprovalInk.of({ requests: queue })),
    );
  }),
);
