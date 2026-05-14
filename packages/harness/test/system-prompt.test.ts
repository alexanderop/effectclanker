import { describe, expect, it } from "@effect/vitest";
import { Effect, Ref } from "effect";
import { buildEnvironmentSystemPrompt, chatWithEnvironment } from "../src/index.ts";
import { withLanguageModel } from "./utilities.ts";

const ENV = {
  cwd: "/tmp/work",
  platform: "darwin",
  date: new Date("2026-05-14T00:00:00Z"),
};

describe("buildEnvironmentSystemPrompt", () => {
  it.effect("builds an env block containing cwd, platform, and date", () =>
    Effect.sync(() => {
      const out = buildEnvironmentSystemPrompt(ENV);
      const expectedDate = new Date("2026-05-14T00:00:00Z").toDateString();
      expect(out).toContain("<env>");
      expect(out).toContain("</env>");
      expect(out).toContain("Working directory: /tmp/work");
      expect(out).toContain("Platform: darwin");
      expect(out).toContain(`Today's date: ${expectedDate}`);
    }),
  );

  it.effect("orders env lines: cwd, platform, date", () =>
    Effect.sync(() => {
      const out = buildEnvironmentSystemPrompt(ENV);
      const iCwd = out.indexOf("Working directory:");
      const iPlat = out.indexOf("Platform:");
      const iDate = out.indexOf("Today's date:");
      expect(iCwd).toBeGreaterThan(-1);
      expect(iPlat).toBeGreaterThan(iCwd);
      expect(iDate).toBeGreaterThan(iPlat);
    }),
  );
});

describe("chatWithEnvironment", () => {
  it.effect("seeds history with one system message", () =>
    Effect.gen(function* () {
      const chat = yield* chatWithEnvironment(ENV);
      const history = yield* Ref.get(chat.history);
      expect(history.content).toHaveLength(1);
      const msg = history.content[0];
      expect(msg?.role).toBe("system");
      if (msg?.role === "system") {
        expect(msg.content).toBe(buildEnvironmentSystemPrompt(ENV));
      }
    }).pipe(withLanguageModel({})),
  );
});
