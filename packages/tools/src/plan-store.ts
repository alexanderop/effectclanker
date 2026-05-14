import { Context, Effect, Layer, Ref, Schema } from "effect";

export const PlanStepSchema = Schema.Struct({
  step: Schema.String,
  status: Schema.Literal("pending", "in_progress", "completed"),
});

export type PlanStep = typeof PlanStepSchema.Type;

export interface PlanStoreService {
  readonly set: (steps: ReadonlyArray<PlanStep>) => Effect.Effect<void>;
  readonly get: Effect.Effect<ReadonlyArray<PlanStep>>;
}

export class PlanStore extends Context.Tag("PlanStore")<PlanStore, PlanStoreService>() {}

export const PlanStoreLayer = Layer.effect(
  PlanStore,
  Effect.map(Ref.make<ReadonlyArray<PlanStep>>([]), (ref) =>
    PlanStore.of({
      set: (steps) => Ref.set(ref, steps),
      get: Ref.get(ref),
    }),
  ),
);
