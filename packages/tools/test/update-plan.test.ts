import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { PlanStore, PlanStoreLayer } from "../src/plan-store.ts";
import { updatePlanHandler } from "../src/update-plan.ts";

describe("updatePlanHandler", () => {
  it.effect("writes the plan into PlanStore and returns a count", () =>
    Effect.gen(function* () {
      const result = yield* updatePlanHandler({
        steps: [
          { step: "draft API", status: "completed" },
          { step: "write tests", status: "in_progress" },
          { step: "wire CLI", status: "pending" },
        ],
      });
      expect(result.count).toBe(3);
      const store = yield* PlanStore;
      const plan = yield* store.get;
      expect(plan).toHaveLength(3);
      expect(plan[1]?.status).toBe("in_progress");
    }).pipe(Effect.provide(PlanStoreLayer)),
  );

  it.effect("overwrites the previous plan on each call", () =>
    Effect.gen(function* () {
      yield* updatePlanHandler({
        steps: [{ step: "first", status: "pending" }],
      });
      yield* updatePlanHandler({
        steps: [
          { step: "second", status: "completed" },
          { step: "third", status: "in_progress" },
        ],
      });
      const store = yield* PlanStore;
      const plan = yield* store.get;
      expect(plan).toHaveLength(2);
      expect(plan[0]?.step).toBe("second");
    }).pipe(Effect.provide(PlanStoreLayer)),
  );
});
