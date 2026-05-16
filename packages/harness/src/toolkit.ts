import * as ToolkitMod from "@effect/ai/Toolkit";
import type * as ToolMod from "@effect/ai/Tool";
import type { FileSystem } from "@effect/platform";
import type { CommandExecutor } from "@effect/platform/CommandExecutor";
import { NodeContext } from "@effect/platform-node";
import {
  ApplyPatchTool,
  applyPatchHandler,
  ApprovalAutoApproveLayer,
  type ApprovalPolicy,
  EditTool,
  editHandler,
  GlobTool,
  globHandler,
  GrepTool,
  grepHandler,
  makeSkillTool,
  type PlanStore,
  PlanStoreLayer,
  ReadTool,
  readHandler,
  ShellTool,
  shellHandler,
  type TruncationStore,
  TruncationStoreLive,
  UpdatePlanTool,
  updatePlanHandler,
  WriteTool,
  writeHandler,
} from "@effectclanker/tools";
import { Context, Effect, Layer } from "effect";
import { Skills, SkillsLayer } from "./skills.ts";

// HarnessToolkit is a service tag: the actual toolkit value is constructed at
// layer-build time from the discovered skills snapshot. Consumers (agent-loop,
// the toolkit-via-mock test helper) yield this tag to obtain the toolkit they
// pass to chat.streamText / generateText.
//
// The value type is the open-ended `Toolkit<Record<string, Tool.Any>>` because
// the concrete tool record varies with skills.all. Per-name handler typing is
// lost at this boundary; the runtime dispatch tolerates that.
export type HarnessToolkitValue = ToolkitMod.Toolkit<Record<string, ToolMod.Any>>;
export class HarnessToolkit extends Context.Tag("@effectclanker/HarnessToolkit")<
  HarnessToolkit,
  HarnessToolkitValue
>() {}

type ContextDeps =
  | FileSystem.FileSystem
  | ApprovalPolicy
  | PlanStore
  | CommandExecutor
  | TruncationStore;

const baseHandlers = (context: Context.Context<ContextDeps>) => ({
  read: (params: Parameters<typeof readHandler>[0]) => Effect.provide(readHandler(params), context),
  write: (params: Parameters<typeof writeHandler>[0]) =>
    Effect.provide(writeHandler(params), context),
  edit: (params: Parameters<typeof editHandler>[0]) => Effect.provide(editHandler(params), context),
  apply_patch: (params: Parameters<typeof applyPatchHandler>[0]) =>
    Effect.provide(applyPatchHandler(params), context),
  shell: (params: Parameters<typeof shellHandler>[0]) =>
    Effect.provide(shellHandler(params), context),
  grep: (params: Parameters<typeof grepHandler>[0]) => Effect.provide(grepHandler(params), context),
  glob: (params: Parameters<typeof globHandler>[0]) => Effect.provide(globHandler(params), context),
  update_plan: (params: Parameters<typeof updatePlanHandler>[0]) =>
    Effect.provide(updatePlanHandler(params), context),
});

// Core layer: requires Skills + ContextDeps from the outside. Provides both
// the HarnessToolkit service (a Toolkit value) and the toolkit's handler
// context. The captured-context trick lets each handler typecheck as
// `Effect<S, F, never>` even though the handlers themselves require ContextDeps.
//
// Exposed for tests that want to inject a synthetic Skills layer; production
// callers should reach for `HarnessToolkitLayerBare` instead.
export const HarnessToolkitCoreLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const skills = yield* Skills;
    const skillReg = makeSkillTool(skills.all);

    const toolkit = (skillReg === null
      ? ToolkitMod.make(
          ReadTool,
          WriteTool,
          EditTool,
          ApplyPatchTool,
          ShellTool,
          GrepTool,
          GlobTool,
          UpdatePlanTool,
        )
      : ToolkitMod.make(
          ReadTool,
          WriteTool,
          EditTool,
          ApplyPatchTool,
          ShellTool,
          GrepTool,
          GlobTool,
          UpdatePlanTool,
          skillReg.tool,
        )) as unknown as HarnessToolkitValue;

    const handlerLayer = toolkit.toLayer(
      Effect.gen(function* () {
        const context = yield* Effect.context<ContextDeps>();
        const handlers = baseHandlers(context);
        if (skillReg === null) return handlers as unknown as Record<string, never>;
        return { ...handlers, skill: skillReg.handler } as unknown as Record<string, never>;
      }),
    );

    return Layer.merge(Layer.succeed(HarnessToolkit, toolkit), handlerLayer);
  }),
);

// `provideMerge` instead of `provide` so consumers (CLI, chat-runtime) can
// still `yield* Skills` without depending on SkillsLayer directly. The Skills
// service is satisfied internally for `HarnessToolkitCoreLayer` *and*
// re-exposed.
export const HarnessToolkitLayerBare = HarnessToolkitCoreLayer.pipe(
  Layer.provide(TruncationStoreLive),
  Layer.provideMerge(SkillsLayer),
);

// Self-contained layer: auto-approves every gated action, fresh PlanStore,
// NodeContext provided. Use in tests and trusted-automation scenarios.
export const HarnessToolkitLayer = HarnessToolkitLayerBare.pipe(
  Layer.provide(ApprovalAutoApproveLayer),
  Layer.provide(PlanStoreLayer),
  Layer.provide(NodeContext.layer),
);
