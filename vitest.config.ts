import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx"],
    exclude: ["node_modules/**", "repos/**", "dist/**", "packages/*/node_modules/**"],
    globals: false,
  },
});
