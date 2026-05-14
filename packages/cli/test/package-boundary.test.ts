import { describe, expect, it } from "@effect/vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const packagesDir = join(here, "..", "..");

describe("@effectclanker/cli package boundary", () => {
  it("sits at the top of the layering — no package in packages/* depends on cli", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(packagesDir)) {
      if (name === "cli") continue;
      const manifestPath = join(packagesDir, name, "package.json");
      const raw = readFileSync(manifestPath, "utf8");
      const pkg = JSON.parse(raw) as {
        readonly dependencies?: Record<string, string>;
        readonly peerDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
      if ("@effectclanker/cli" in deps) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });
});
