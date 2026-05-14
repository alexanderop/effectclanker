import { describe, expect, it } from "@effect/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
};

describe("@effectclanker/harness package boundary", () => {
  const deps = { ...pkg.dependencies, ...pkg.peerDependencies };

  it("depends on @effectclanker/tools", () => {
    expect(deps).toHaveProperty("@effectclanker/tools");
  });

  it("does not depend on upward packages", () => {
    expect(deps).not.toHaveProperty("@effectclanker/tui");
    expect(deps).not.toHaveProperty("@effectclanker/cli");
  });
});
