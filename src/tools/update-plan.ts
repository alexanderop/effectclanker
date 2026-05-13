import { Tool } from "@effect/ai";
import { Effect, Schema } from "effect";
import { PlanStepSchema, PlanStore } from "../services/plan-store.ts";

export const UpdatePlanTool = Tool.make("update_plan", {
  description:
    "Set the current plan. Pass an ordered list of {step, status} where status is one of 'pending' | 'in_progress' | 'completed'. Use to track multi-step work so the user can see progress.",
  parameters: {
    steps: Schema.Array(PlanStepSchema),
  },
  success: Schema.Struct({ count: Schema.Number }),
});

export interface UpdatePlanParams {
  readonly steps: ReadonlyArray<typeof PlanStepSchema.Type>;
}

export const updatePlanHandler = ({
  steps,
}: UpdatePlanParams): Effect.Effect<{ readonly count: number }, never, PlanStore> =>
  Effect.gen(function* () {
    const store = yield* PlanStore;
    yield* store.set([...steps]);
    return { count: steps.length };
  });
