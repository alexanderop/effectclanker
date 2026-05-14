# Modular pi-style monorepo structure

## Goal

Split the single `src/` tree into a Bun-workspaces monorepo with four layered packages — `tools`, `harness`, `tui`, `cli` — mirroring pi's `packages/*` shape so each layer can be reasoned about, tested, and depended on independently.

## Requirements

- Top-level layout is `packages/{tools,harness,tui,cli}/{src,test}` with each package owning its `package.json`, `tsconfig.json`, and `vitest.config.ts`. The root `package.json` declares `"workspaces": ["packages/*"]`.
- Package names are `@effectclanker/tools`, `@effectclanker/harness`, `@effectclanker/tui`, `@effectclanker/cli`. All are `"private": true`.
- Dependency direction is strictly downward: `cli → tui → harness → tools`. No package's `dependencies` or `peerDependencies` list any package above it. A package may skip levels (cli can depend directly on harness or tools), but never reach upward.
- `packages/tools/` owns: every `Tool.make` spec + handler (`apply-patch`, `bash`, `edit`, `glob`, `grep`, `read`, `update-plan`, `write`), the shared `errors.ts`, and the `Context.Tag`s + pure layers for cross-cutting services (`ApprovalPolicy` tag, `ApprovalAutoApproveLayer`, `ApprovalDenyAllLayer`, `PlanStore` tag + `PlanStoreLayer`).
- `packages/harness/` owns: `Toolkit.make(...)` composition (`HarnessToolkit`, `HarnessToolkitLayerBare`, `HarnessToolkitLayer`) and the `ApprovalInteractiveLayer` (the `Terminal.readLine`-driven one).
- `packages/tui/` owns: the Ink chat layer (`chat-runtime.tsx`, `chat-ui.tsx`, `chat-state.ts`, `chat.ts`) plus `ApprovalInkLayer` + the `ApprovalInk` tag (Ink-modal bridge) and its `ApprovalAutoApproveInkLayer` / `ApprovalDenyAllInkLayer` companions.
- `packages/cli/` owns: `cli.ts` (`@effect/cli` entry point with `run` and `chat` subcommands) and any future mode wiring. The `bin` target it produces replaces today's `bun src/cli.ts`.
- Tests are co-located: each package's `test/` is self-contained and can be run with `bun --filter @effectclanker/<name> test`. fs helpers (`withTmpDir`, `withTmpFile`, `expectLeft`) live in `packages/tools/test/utilities.ts`; mock-model helpers (`mockText`, `mockToolCall`, `runToolkit`, `withLanguageModel`) live in `packages/harness/test/utilities.ts`; Ink-render helpers live in `packages/tui/test/utilities.ts`.
- Every existing test continues to pass from its new home — no behavior change is in scope.
- Each package has its own `vitest.config.ts`. tsconfig uses `references` from the root so `bun run typecheck` builds the project graph in dependency order. oxlint and oxfmt continue running from the root with the existing `repos/**` ignore patterns plus new `packages/**/dist/**` excludes if any.
- The repo-root `bun run check` runs typecheck (`tsc -b` over the references), then lint, then format:check, then `bun run --recursive test` (or equivalent root command that runs every package's vitest).
- The top-level `src/` directory is deleted at the end. No barrel `src/index.ts` shim remains.
- `CLAUDE.md` and `docs/architecture.md` are updated so the "Code architecture" table and the dataflow / layer descriptions reference the new package paths; `docs/guides/adding-a-tool.md` is updated so the recipe lands in `packages/tools/src/<name>.ts` with its test in `packages/tools/test/<name>.test.ts`.

## Implementation hints

- Read `repos/pi/packages/coding-agent/package.json`, `repos/pi/packages/agent/package.json`, `repos/pi/package.json` (root) for the workspace shape. Pi uses npm workspaces with explicit `"workspaces": [...]` at the root and per-package `tsconfig.build.json` + `vitest.config.ts`.
- Read `repos/pi/packages/agent/src/index.ts` for the "barrel export per package" pattern.
- Current sources to move, by package:
  - `tools` ← `/Users/alexanderopalic/Projects/effectclanker/src/tools/*.ts` + the _tag and pure layers_ portion of `/Users/alexanderopalic/Projects/effectclanker/src/services/approval-policy.ts` + `/Users/alexanderopalic/Projects/effectclanker/src/services/plan-store.ts`.
  - `harness` ← `/Users/alexanderopalic/Projects/effectclanker/src/toolkit.ts` + `ApprovalInteractiveLayer` from `approval-policy.ts`.
  - `tui` ← `/Users/alexanderopalic/Projects/effectclanker/src/chat-runtime.tsx`, `chat-ui.tsx`, `chat-state.ts`, `chat.ts` + `ApprovalInkLayer` / `ApprovalInk` / `NoOpApprovalInkLayer` / `ApprovalAutoApproveInkLayer` / `ApprovalDenyAllInkLayer` from `approval-policy.ts`.
  - `cli` ← `/Users/alexanderopalic/Projects/effectclanker/src/cli.ts`.
- Current tests to move, by package:
  - `tools` ← `/Users/alexanderopalic/Projects/effectclanker/test/tools/*.test.ts`.
  - `harness` ← `/Users/alexanderopalic/Projects/effectclanker/test/toolkit.test.ts` and the toolkit-related portion of `/Users/alexanderopalic/Projects/effectclanker/test/utilities.ts` (`mockText`, `mockToolCall`, `runToolkit`, `withLanguageModel`).
  - `tui` ← `/Users/alexanderopalic/Projects/effectclanker/test/approval-ink.test.ts`, `/Users/alexanderopalic/Projects/effectclanker/test/chat.test.ts`.
- `ApprovalDenied` (today in `src/tools/errors.ts`) is imported by approval layers in all three of `tools`/`harness`/`tui`. Keep `errors.ts` in `packages/tools/src/errors.ts` and let higher packages import it — that's the layering, not a violation.
- `HarnessToolkitLayerBare` captures `Effect.context<FileSystem | ApprovalPolicy | PlanStore | CommandExecutor>()` to re-provide it per handler. The same trick survives the move; only the import paths change.
- Phased migration is the safest path. Suggested order — finish (and `bun run check`) each phase before starting the next:
  1. **Workspace skeleton.** Add `"workspaces": ["packages/*"]` to root `package.json`, create empty `packages/{tools,harness,tui,cli}/package.json` + `tsconfig.json` + `vitest.config.ts`. Root `tsconfig.json` gains `references`. `bun install` runs clean.
  2. **`tools`.** Move tool files, errors, ApprovalPolicy tag + pure layers, PlanStore. Move handler-direct tests + fs helpers. Add `tools` boundary test (see acceptance below).
  3. **`harness`.** Move toolkit + ApprovalInteractiveLayer. Move `test/toolkit.test.ts` and the mock-LLM half of `test/utilities.ts`. Add `harness` boundary test.
  4. **`tui`.** Move chat-\* files + Ink approval layers + `approval-ink.test.ts` + `chat.test.ts`. Add `tui` boundary test.
  5. **`cli`.** Move `cli.ts`; update its `bin` entry in its `package.json`. Add `cli` boundary test. Delete top-level `src/` and the old root `test/`.
  6. **Docs.** Update CLAUDE.md and `docs/architecture.md` / `docs/guides/adding-a-tool.md` paths.
- For the boundary test, importing `package.json` in TypeScript works with `tsconfig`'s `"resolveJsonModule": true` (already set in this repo). Read the JSON statically — do not exec anything.
- Don't try to be clever with a shared `packages/test-utils`. Per-package `test/utilities.ts` is what we agreed on; duplicating two helpers across two packages is cheaper than the workspace it would cost.
- `docs/patterns/effect-ai-gotchas.md` has notes on `failureMode: "return"` and Layer scoping — both survive the move unchanged but read it once before touching toolkit wiring.
- This is a structural refactor with no public API. Don't add new behavior. Don't tidy or rename tools, services, or test descriptions while moving — diff noise hides real regressions.

## Acceptance criteria

TDD order — write the first test, watch it fail, then make it pass. Then the next.

- [ ] **Red:** `packages/tools/test/package-boundary.test.ts` — `it("@effectclanker/tools declares no upward package dependencies")` reads `packages/tools/package.json` and asserts neither `dependencies` nor `peerDependencies` contains `@effectclanker/harness`, `@effectclanker/tui`, or `@effectclanker/cli`. Fails now because the file and package don't exist.
- [ ] **Green:** the boundary test passes once `packages/tools/package.json` exists with only lower-layer deps.
- [ ] Every test file under `/Users/alexanderopalic/Projects/effectclanker/test/tools/*.test.ts` runs from its new home at `packages/tools/test/<name>.test.ts` and passes unchanged (modulo import path rewrites). Verified by `bun --filter @effectclanker/tools test`.
- [ ] `packages/harness/test/package-boundary.test.ts` — `it("@effectclanker/harness depends on tools only")` reads `packages/harness/package.json` and asserts deps include `@effectclanker/tools` but not `@effectclanker/tui` or `@effectclanker/cli`. Red until harness package exists.
- [ ] `packages/harness/test/toolkit.test.ts` (the relocated `test/toolkit.test.ts`) passes via `bun --filter @effectclanker/harness test`.
- [ ] `packages/tui/test/package-boundary.test.ts` — `it("@effectclanker/tui depends on harness/tools only")` reads `packages/tui/package.json` and asserts deps may include `@effectclanker/harness` and/or `@effectclanker/tools` but not `@effectclanker/cli`. Red until tui package exists.
- [ ] `packages/tui/test/approval-ink.test.ts` and `packages/tui/test/chat.test.ts` pass via `bun --filter @effectclanker/tui test`.
- [ ] `packages/cli/test/package-boundary.test.ts` — `it("@effectclanker/cli sits at the top of the layering")` reads `packages/cli/package.json` and asserts no package in `packages/*` lists `@effectclanker/cli` as a dependency. Red until cli is the leaf consumer.
- [ ] `bun packages/cli/src/cli.ts --help` runs without `ANTHROPIC_API_KEY` and prints the same `run` / `chat` subcommands the old `bun src/cli.ts --help` did.
- [ ] Top-level `src/` and top-level `test/` directories no longer exist. `git ls-files src test | wc -l` returns 0.
- [ ] Root `bun run check` (typecheck → lint → format:check → all-package tests) passes.
- [ ] CLAUDE.md "Code architecture" table and `docs/architecture.md` layer paragraphs reference `packages/...` paths, not `src/...`. `docs/guides/adding-a-tool.md` recipe places the new tool under `packages/tools/src/`.
- [ ] No `setTimeout`, no real LLM calls, no flaky waits introduced — per `CLAUDE.md`.
