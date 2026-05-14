#!/usr/bin/env bun
import { LanguageModel } from "@effect/ai";
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { Args, Command, Options } from "@effect/cli";
import { FetchHttpClient } from "@effect/platform";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import {
  ApprovalAutoApproveLayer,
  ApprovalDenyAllLayer,
  PlanStore,
  PlanStoreLayer,
} from "@effectclanker/tools";
import {
  ApprovalInteractiveLayer,
  HarnessToolkit,
  HarnessToolkitLayerBare,
} from "@effectclanker/harness";
// Layer is still used for AnthropicClient's HttpClient wiring below.
import {
  ApprovalAutoApproveInkLayer,
  ApprovalDenyAllInkLayer,
  ApprovalInkLayer,
  runChatApp,
} from "@effectclanker/tui";
import { Config, Console, Effect, Layer } from "effect";

const promptArg = Args.text({ name: "prompt" }).pipe(
  Args.withDescription("The prompt to send to the model"),
);

const modelOption = Options.text("model").pipe(
  Options.withDefault("claude-haiku-4-5"),
  Options.withDescription("Anthropic model id"),
);

const approvalOption = Options.choice("approval", ["auto", "interactive", "deny"] as const).pipe(
  Options.withDefault("auto" as const),
  Options.withDescription(
    "Approval policy for gated tools (bash). auto = run everything; interactive = prompt y/N; deny = reject every gated call.",
  ),
);

const buildApprovalLayer = (mode: "auto" | "interactive" | "deny") => {
  switch (mode) {
    case "auto":
      return ApprovalAutoApproveLayer;
    case "interactive":
      return ApprovalInteractiveLayer;
    case "deny":
      return ApprovalDenyAllLayer;
  }
};

const renderToolResult = (result: unknown): string => {
  if (result === null || result === undefined) return String(result);
  if (typeof result === "string") {
    return result.length > 200
      ? `${result.slice(0, 200)}… (+${result.length - 200} chars)`
      : result;
  }
  return JSON.stringify(result);
};

const runCommand = Command.make(
  "run",
  { model: modelOption, prompt: promptArg, approval: approvalOption },
  ({ approval, model, prompt }) =>
    Effect.gen(function* () {
      const response = yield* LanguageModel.generateText({
        prompt,
        toolkit: HarnessToolkit,
      });

      yield* Console.log("---");
      if (response.text.trim().length > 0) {
        yield* Console.log(`text: ${response.text}`);
      }
      if (response.toolCalls.length > 0) {
        yield* Console.log(`tool calls (${response.toolCalls.length}):`);
        yield* Effect.forEach(response.toolCalls, (call) =>
          Console.log(`  - ${call.name}(${JSON.stringify(call.params)})`),
        );
      }
      if (response.toolResults.length > 0) {
        yield* Console.log(`tool results (${response.toolResults.length}):`);
        yield* Effect.forEach(response.toolResults, (tr) => {
          const marker = tr.isFailure ? "FAIL" : "ok";
          return Console.log(`  - [${marker}] ${tr.name}: ${renderToolResult(tr.result)}`);
        });
      }

      // Surface the plan if the model populated it via update_plan.
      const planStore = yield* PlanStore;
      const plan = yield* planStore.get;
      if (plan.length > 0) {
        yield* Console.log(`plan (${plan.length} step${plan.length === 1 ? "" : "s"}):`);
        yield* Effect.forEach(plan, (item, idx) => {
          const marker =
            item.status === "completed" ? "x" : item.status === "in_progress" ? "~" : " ";
          return Console.log(`  ${idx + 1}. [${marker}] ${item.step}`);
        });
      }

      yield* Console.log(`finish: ${response.finishReason}`);
    }).pipe(
      // Layers are stacked outermost-last so each call satisfies the layer
      // above it. AnthropicClient is scoped inside the handler so `--help`
      // doesn't require ANTHROPIC_API_KEY.
      Effect.provide(HarnessToolkitLayerBare),
      Effect.provide(buildApprovalLayer(approval)),
      Effect.provide(PlanStoreLayer),
      Effect.provide(AnthropicLanguageModel.layer({ model })),
      Effect.provide(AnthropicClientLive),
    ),
);

// Chat mode uses the dedicated `ApprovalInkLayer` (Ink-modal approval) when
// approval=interactive — the terminal-readLine implementation would fight the
// renderer for stdin. auto and deny pair their existing policies with a no-op
// `ApprovalInk` so the chat-runtime can always `yield* ApprovalInk` regardless.
const buildChatApprovalLayer = (mode: "auto" | "interactive" | "deny") => {
  switch (mode) {
    case "auto":
      return ApprovalAutoApproveInkLayer;
    case "interactive":
      return ApprovalInkLayer;
    case "deny":
      return ApprovalDenyAllInkLayer;
  }
};

const chatProgram = (model: string, approval: "auto" | "interactive" | "deny") =>
  Effect.scoped(runChatApp({ approvalMode: approval, model })).pipe(
    Effect.provide(HarnessToolkitLayerBare),
    Effect.provide(buildChatApprovalLayer(approval)),
    Effect.provide(PlanStoreLayer),
    Effect.provide(AnthropicLanguageModel.layer({ model })),
    Effect.provide(AnthropicClientLive),
  );

const chatCommand = Command.make(
  "chat",
  { model: modelOption, approval: approvalOption },
  ({ approval, model }) => chatProgram(model, approval),
);

const harness = Command.make("harness", { model: modelOption, approval: approvalOption }, (args) =>
  chatProgram(args.model, args.approval),
).pipe(Command.withSubcommands([runCommand, chatCommand]));

const cli = Command.run(harness, {
  name: "effectclanker",
  version: "0.0.1",
});

const AnthropicClientLive = AnthropicClient.layerConfig({
  apiKey: Config.redacted("ANTHROPIC_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

const MainLive = NodeContext.layer;

Effect.suspend(() => cli(process.argv)).pipe(Effect.provide(MainLive), NodeRuntime.runMain);
