#!/usr/bin/env bun
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
  chatWithEnvironment,
  HarnessToolkitLayerBare,
  loadAgentsFile,
  runAgentTurn,
  Skills,
  stepCountIs,
  type TurnEvent,
} from "@effectclanker/harness";
// Layer is still used for AnthropicClient's HttpClient wiring below.
import {
  ApprovalAutoApproveInkLayer,
  ApprovalDenyAllInkLayer,
  ApprovalInkLayer,
  runChatApp,
} from "@effectclanker/tui";
import { Config, Console, Effect, Layer, Stream } from "effect";

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

interface CumulativeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface RunAccumulator {
  text: string;
  toolCalls: Array<Extract<TurnEvent, { kind: "tool-call" }>>;
  toolResults: Array<Extract<TurnEvent, { kind: "tool-result" }>>;
  finishReason: string;
  errors: Array<string>;
  usage: CumulativeUsage;
}

// Same shape as the chat-ui footer stats line. Each Round's `finish` event
// contributes; reporting cumulative numbers at end of turn makes a single-turn
// `run` summary directly comparable to chat's session totals.
const formatTokens = (count: number): string => {
  if (count < 1000) return count.toString();
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
};

const formatUsageLine = (usage: CumulativeUsage): string | null => {
  const parts: Array<string> = [];
  if (usage.inputTokens > 0) parts.push(`↑${formatTokens(usage.inputTokens)}`);
  if (usage.outputTokens > 0) parts.push(`↓${formatTokens(usage.outputTokens)}`);
  if (usage.cacheReadTokens > 0) parts.push(`R${formatTokens(usage.cacheReadTokens)}`);
  if (usage.cacheWriteTokens > 0) parts.push(`W${formatTokens(usage.cacheWriteTokens)}`);
  return parts.length === 0 ? null : parts.join(" ");
};

const runCommand = Command.make(
  "run",
  { model: modelOption, prompt: promptArg, approval: approvalOption },
  ({ approval, model, prompt }) =>
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
      const acc: RunAccumulator = {
        text: "",
        toolCalls: [],
        toolResults: [],
        finishReason: "unknown",
        errors: [],
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };

      // Stream the agent loop live: print each tool-call, tool-result, and
      // text-delta as it arrives, while accumulating state for the final
      // summary block below.
      yield* runAgentTurn({ chat, prompt, stopWhen: stepCountIs(25) }).pipe(
        Stream.runForEach((event) => {
          switch (event.kind) {
            case "text-delta":
              acc.text += event.delta;
              return Effect.sync(() => process.stdout.write(event.delta));
            case "tool-call":
              acc.toolCalls.push(event);
              return Console.log(`\n→ ${event.name}(${JSON.stringify(event.params)})`);
            case "tool-result":
              acc.toolResults.push(event);
              return Console.log(
                `← [${event.isFailure ? "FAIL" : "ok"}] ${event.name}: ${renderToolResult(event.result)}`,
              );
            case "finish":
              acc.finishReason = event.reason;
              acc.usage.inputTokens += event.usage.inputTokens;
              acc.usage.outputTokens += event.usage.outputTokens;
              acc.usage.cacheReadTokens += event.usage.cacheReadTokens;
              acc.usage.cacheWriteTokens += event.usage.cacheWriteTokens;
              return Effect.void;
            case "error":
              acc.errors.push(event.message);
              return Console.log(`\n! error: ${event.message}`);
          }
        }),
      );

      yield* Console.log("\n---");
      if (acc.text.trim().length > 0) {
        yield* Console.log(`text: ${acc.text}`);
      }
      if (acc.toolCalls.length > 0) {
        yield* Console.log(`tool calls (${acc.toolCalls.length}):`);
        yield* Effect.forEach(acc.toolCalls, (call) =>
          Console.log(`  - ${call.name}(${JSON.stringify(call.params)})`),
        );
      }
      if (acc.toolResults.length > 0) {
        yield* Console.log(`tool results (${acc.toolResults.length}):`);
        yield* Effect.forEach(acc.toolResults, (tr) => {
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

      yield* Console.log(`finish: ${acc.finishReason}`);
      const usageLine = formatUsageLine(acc.usage);
      if (usageLine !== null) {
        yield* Console.log(`tokens: ${usageLine}`);
      }
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
