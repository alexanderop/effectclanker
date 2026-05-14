import { describe, expect, it } from "@effect/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
};

describe("@effectclanker/tools package boundary", () => {
  it("declares no upward package dependencies", () => {
    const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
    for (const name of ["@effectclanker/harness", "@effectclanker/tui", "@effectclanker/cli"]) {
      expect(deps).not.toHaveProperty(name);
    }
  });
});
