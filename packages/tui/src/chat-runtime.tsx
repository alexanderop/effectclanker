import { Deferred, Effect, Fiber, Queue, Ref } from "effect";
import { render } from "ink";
import React, { useEffect, useState } from "react";
import { runChatTurn, slashCommand } from "./chat.ts";
import { makeChatStateController } from "./chat-state.ts";
import { ChatApp } from "./chat-ui.tsx";
import { PlanStore } from "@effectclanker/tools";
import { chatWithEnvironment, loadAgentsFile, Skills } from "@effectclanker/harness";
import { listSlashCommands } from "./slash-commands.ts";
import { ApprovalInk, type PendingApproval } from "./approval-ink.ts";

interface ChatLoopOptions {
  readonly model: string;
  readonly approvalMode: "auto" | "interactive" | "deny";
}

// Bootstraps the Ink renderer, hands the chat-loop fiber a Queue<string> for
// user input, and wires the approval bridge (when present) into the UI's
// pending-approval state.
export const runChatApp = (options: ChatLoopOptions) =>
  Effect.gen(function* () {
    const skills = yield* Skills;
    const agentsFile = yield* loadAgentsFile(process.cwd());
    const chat = yield* chatWithEnvironment({
      cwd: process.cwd(),
      platform: process.platform,
      date: new Date(),
      agentsFile,
      skills: skills.all,
    });
    const seedPrompt = yield* Ref.get(chat.history);
    const slashCommands = listSlashCommands(skills.all);
    const controller = makeChatStateController();
    const inputQueue = yield* Queue.unbounded<string>();
    const cancelRef = yield* Ref.make<Fiber.Fiber<void> | null>(null);
    const exitSignal = yield* Deferred.make<void>();

    // After every turn, refresh the plan view from PlanStore. PlanStore's `get`
    // is total (no error channel), so no recovery needed.
    const refreshPlan = Effect.gen(function* () {
      const planStore = yield* PlanStore;
      const plan = yield* planStore.get;
      controller.setPlan(plan);
    });

    // Pulled unconditionally: auto/deny modes provide a no-op ApprovalInk so
    // this lookup always succeeds. The queue stays empty for those modes,
    // making the listener fiber below an idle parker.
    const approvalBridge = yield* ApprovalInk;

    // React-side state for the currently pending approval. We expose imperative
    // setters via a Ref-backed React Bridge (set from the chat loop, read from
    // the App component).
    const pendingApprovalListeners = new Set<(p: PendingApproval | null) => void>();
    let currentPending: PendingApproval | null = null;
    const setPending = (p: PendingApproval | null): void => {
      currentPending = p;
      for (const cb of pendingApprovalListeners) cb(p);
    };

    // Fork the listener that takes pending approval requests off the queue
    // and pushes them to the React UI. Idle for auto/deny modes (empty queue).
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const pending = yield* Queue.take(approvalBridge.requests);
          setPending(pending);
          yield* Deferred.await(pending.decision);
          setPending(null);
        }),
      ),
    );

    const handleApprovalDecision = (approve: boolean): void => {
      const pending = currentPending;
      if (pending === null) return;
      Effect.runSync(Deferred.succeed(pending.decision, approve));
    };

    // Main chat loop: read a line, dispatch, repeat.
    const chatLoop = Effect.forever(
      Effect.gen(function* () {
        const line = yield* Queue.take(inputQueue);
        const result = yield* slashCommand(line, chat, skills, seedPrompt);

        if (result.kind === "quit") {
          yield* Deferred.succeed(exitSignal, undefined);
          return;
        }
        if (result.kind === "handled") {
          controller.appendUser(line);
          controller.appendSystem(result.text);
          return;
        }
        if (result.kind === "cleared") {
          // Drop the visible transcript so the user sees a fresh session,
          // then surface the cleared-confirmation system line.
          controller.clearTranscript();
          controller.appendSystem(result.text);
          return;
        }

        // Passthrough: forward to the model as a normal turn.
        controller.appendUser(line);
        controller.setStatus("streaming");
        const turnFiber = yield* Effect.fork(
          runChatTurn({
            chat,
            prompt: result.text,
            onEvent: (event) => Effect.sync(() => controller.applyEvent(event)),
          }),
        );
        yield* Ref.set(cancelRef, turnFiber);
        // `runChatTurn` never fails on its error channel — failures are
        // surfaced as `error` TurnEvents. `Fiber.await` returns the Exit
        // without throwing, so an interrupt (Ctrl-C) is also harmless here.
        yield* Fiber.await(turnFiber);
        yield* Ref.set(cancelRef, null);
        controller.setStatus("ready");
        yield* refreshPlan;
      }),
    );

    const loopFiber = yield* Effect.forkScoped(chatLoop);

    const handleSubmit = (line: string): void => {
      Effect.runSync(Queue.offer(inputQueue, line));
    };
    const handleCancel = (): void => {
      const fiber = Effect.runSync(Ref.get(cancelRef));
      if (fiber === null) return;
      Effect.runSync(Fiber.interrupt(fiber));
    };
    const handleExit = (): void => {
      Effect.runSync(Deferred.succeed(exitSignal, undefined));
    };

    const PendingApprovalBridge: React.FC<{
      children: (p: PendingApproval | null) => React.ReactNode;
    }> = ({ children }) => {
      const [pending, setPendingState] = useState<PendingApproval | null>(currentPending);
      useEffect(() => {
        pendingApprovalListeners.add(setPendingState);
        return () => {
          pendingApprovalListeners.delete(setPendingState);
        };
      }, []);
      return <>{children(pending)}</>;
    };

    const instance = render(
      <PendingApprovalBridge>
        {(pending) => (
          <ChatApp
            controller={controller}
            model={options.model}
            approvalMode={options.approvalMode}
            slashCommands={slashCommands}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            onExit={handleExit}
            pendingApproval={pending}
            onApprovalDecision={handleApprovalDecision}
          />
        )}
      </PendingApprovalBridge>,
    );

    yield* Deferred.await(exitSignal);
    instance.unmount();
    yield* Fiber.interrupt(loopFiber);
  });
