import { Toolkit } from "@effect/ai";
import type { FileSystem } from "@effect/platform";
import type { CommandExecutor } from "@effect/platform/CommandExecutor";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { ApprovalAutoApproveLayer, type ApprovalPolicy } from "./services/approval-policy.ts";
import { type PlanStore, PlanStoreLayer } from "./services/plan-store.ts";
import { ApplyPatchTool, applyPatchHandler } from "./tools/apply-patch.ts";
import { BashTool, bashHandler } from "./tools/bash.ts";
import { EditTool, editHandler } from "./tools/edit.ts";
import { GlobTool, globHandler } from "./tools/glob.ts";
import { GrepTool, grepHandler } from "./tools/grep.ts";
import { ReadTool, readHandler } from "./tools/read.ts";
import { UpdatePlanTool, updatePlanHandler } from "./tools/update-plan.ts";
import { WriteTool, writeHandler } from "./tools/write.ts";

export const HarnessToolkit = Toolkit.make(
  ReadTool,
  WriteTool,
  EditTool,
  ApplyPatchTool,
  BashTool,
  GrepTool,
  GlobTool,
  UpdatePlanTool,
);

// Bare layer: still requires ApprovalPolicy + PlanStore + FileSystem +
// CommandExecutor. Used by the CLI to swap in different approval policies.
//
// We capture the surrounding context once and re-provide it inside each handler
// so that the handlers themselves type as `Effect<S, F, never>` — which is what
// `Toolkit.toLayer` insists on. Without this trick every handler would have to
// drop its `R` channel by hand at every call site.
export const HarnessToolkitLayerBare = HarnessToolkit.toLayer(
  Effect.gen(function* () {
    const context = yield* Effect.context<
      FileSystem.FileSystem | ApprovalPolicy | PlanStore | CommandExecutor
    >();
    return {
      read: (params) => Effect.provide(readHandler(params), context),
      write: (params) => Effect.provide(writeHandler(params), context),
      edit: (params) => Effect.provide(editHandler(params), context),
      apply_patch: (params) => Effect.provide(applyPatchHandler(params), context),
      bash: (params) => Effect.provide(bashHandler(params), context),
      grep: (params) => Effect.provide(grepHandler(params), context),
      glob: (params) => Effect.provide(globHandler(params), context),
      update_plan: (params) => Effect.provide(updatePlanHandler(params), context),
    };
  }),
);

// Self-contained layer: auto-approves every gated action, fresh PlanStore,
// NodeContext provided. Use in tests and trusted-automation scenarios.
export const HarnessToolkitLayer = HarnessToolkitLayerBare.pipe(
  Layer.provide(ApprovalAutoApproveLayer),
  Layer.provide(PlanStoreLayer),
  Layer.provide(NodeContext.layer),
);
