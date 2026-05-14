# effectclanker

A learning-grade coding harness built on Effect-TS and `@effect/ai`. The project exists to learn Effect by reading the OpenAI Codex source and reproducing its patterns in TypeScript. It is not a polished product.

The harness wires six tools (`read`, `write`, `edit`, `shell`, `grep`, `glob`) into an Anthropic-backed `LanguageModel`. You give it a prompt; it calls tools until it has an answer.

## Stack

- **Bun** — package manager, script runner, CLI runtime.
- **Node** — test runtime (Vitest doesn't fully support Bun yet).
- **TypeScript** — strict; typecheck via `tsc --noEmit`.
- **`@effect/ai`** + **`@effect/ai-anthropic`** — `LanguageModel`, `Tool`, `Toolkit`.
- **`@effect/cli`** — CLI entry point.
- **`@effect/platform-node`** — `NodeContext`, `NodeRuntime`, `FetchHttpClient`.
- **oxlint** + **oxfmt** — Rust-based lint and format.
- **Vitest** + **`@effect/vitest`** — test runner with `it.effect(...)` helper.

## Commands

| Command                                      | What it does                                          |
| -------------------------------------------- | ----------------------------------------------------- |
| `bun install`                                | install deps                                          |
| `bun run check`                              | full pipeline: typecheck → lint → format:check → test |
| `bun run typecheck`                          | `tsc --noEmit`                                        |
| `bun run lint`                               | `oxlint`                                              |
| `bun run format`                             | `oxfmt` — writes fixes                                |
| `bun run format:check`                       | `oxfmt --check` — read-only                           |
| `bun run test`                               | `vitest run` (one-shot)                               |
| `bun run test:watch`                         | `vitest` (watch mode)                                 |
| `bun packages/cli/src/cli.ts run "<prompt>"` | invoke the harness — requires `ANTHROPIC_API_KEY`     |
| `bun packages/cli/src/cli.ts --help`         | CLI help — no API key required                        |

- **CRITICAL**: Run `bun run check` before declaring a change done. Your code does not work if you didn't run the tests.
- Single test file: `bun run test packages/tools/test/edit.test.ts`
- Single test by name: `bun run test packages/tools/test/edit.test.ts -t "fails when patch context is wrong"`
- Per-package: `bun --filter @effectclanker/tools test`

## Before you change anything

The `docs/` directory is the project vault — persistent memory across sessions.

- `docs/index.md` is the auto-generated vault map. It's injected at session start, so you already see what knowledge is available. Read the relevant entries before acting.
- `docs/overview.md` is the curated landing page — the "start here, in order" reading list plus reference-repo notes.

The most-touched files, by frequency:

- `docs/architecture.md` — the three layers (`Tool` / `Toolkit` / `LanguageModel`), where each one lives, how a prompt becomes a response.
- `docs/guides/adding-a-tool.md` — the recipe for the most common task in this codebase.
- `docs/testing-strategy.md` — the test pyramid and why we don't hit real LLMs in CI. Read this _before_ the mechanics doc below.
- `docs/guides/testing.md` — `it.effect`, the `withLanguageModel` mock, handler-direct vs toolkit-via-mock test styles, `Effect.acquireUseRelease` for tmp dirs.
- `docs/tooling.md` — deeper notes on the stack and the `check` pipeline.
- `docs/patterns/effect-ai-gotchas.md` — non-obvious things that will bite you (`failureMode: "return"`, Layer scoping, the internal turn loop).
- `docs/principles.md` — engineering principles, indexed under `docs/principles/`. Refer back when planning or reviewing.

Do not guess at `@effect/ai` semantics — the source is vendored at `repos/effect/`. Read it.

## Reference repositories

Source-of-truth code for libraries we depend on and patterns we model after. Treat as **read-only reference material** — do not edit files under `repos/`. When in doubt about an `@effect/*` API, how Codex does X, or how `pi` solves a similar agent-harness problem, read the source there instead of guessing or asking an LLM.

- `repos/effect/` — https://github.com/Effect-TS/effect @ main (squashed)
- `repos/codex/` — https://github.com/openai/codex.git @ main (squashed)
- `repos/pi/` — https://github.com/earendil-works/pi.git @ main (squashed)
- `repos/opencode/` — https://github.com/anomalyco/opencode.git @ dev (squashed)

oxlint and oxfmt carry explicit `repos/**` ignore patterns — vendored source is not subject to our style rules.

## Code architecture

Four Bun workspaces under `packages/`, layered strictly downward (`cli → tui → harness → tools`):

| Path                                           | What it is                                                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/tools/src/*.ts`                      | One file per tool. Each exports a `Tool.make` spec and a handler function. Also owns `errors.ts`, `ApprovalPolicy` tag + pure layers (auto / deny), and `PlanStore`. |
| `packages/tools/test/*.test.ts`                | Handler-direct tests (one per tool) + `test/utilities.ts` with fs helpers (`withTmpDir`, `withTmpFile`, `expectLeft`).                                               |
| `packages/harness/src/toolkit.ts`              | `Toolkit.make(...)` of all tools, plus `HarnessToolkitLayerBare` / `HarnessToolkitLayer`.                                                                            |
| `packages/harness/src/approval-interactive.ts` | `ApprovalInteractiveLayer` (Terminal-readLine prompt).                                                                                                               |
| `packages/harness/test/*.test.ts`              | `toolkit.test.ts` (end-to-end through `generateText` with a mock model) + `test/utilities.ts` with mock-LLM helpers.                                                 |
| `packages/tui/src/*`                           | Ink chat layer (`chat-runtime.tsx`, `chat-ui.tsx`, `chat-state.ts`, `chat.ts`, `clipboard.ts`) + `ApprovalInkLayer` and the `ApprovalInk` queue tag.                 |
| `packages/tui/test/*.test.ts`                  | `chat.test.ts`, `approval-ink.test.ts`.                                                                                                                              |
| `packages/cli/src/cli.ts`                      | `@effect/cli` entry point. Wires `AnthropicClient` + `AnthropicLanguageModel`. `bin` target.                                                                         |
| `packages/cli/test/*.test.ts`                  | Boundary test — nothing in `packages/*` depends on `@effectclanker/cli`.                                                                                             |

Each package also has `package.json`, `tsconfig.json`, and `vitest.config.ts`. The dependency direction is enforced by per-package `test/package-boundary.test.ts` files.

The three layers — `Tool` (spec), `Toolkit` (registry + handler wiring), `LanguageModel` (driver) — are deliberately separable. Read `docs/architecture.md` before refactoring across the boundary.

## Testing

Two tiers, both run by Vitest under Node via `@effect/vitest`:

- **Handler-direct** (`packages/tools/test/*.test.ts`) — call the handler function directly. No model, no toolkit machinery. Fast. Most coverage lives here.
- **Toolkit-via-mock** (`packages/harness/test/toolkit.test.ts`) — drive `LanguageModel.generateText` with a scripted mock model that emits scripted tool-call parts. Verifies the toolkit dispatches and reports correctly.

We do **not** hit real LLMs in CI. See `docs/testing-strategy.md` for the rationale.

### Writing tests

```typescript
import { it } from "@effect/vitest";
import { expect } from "vitest";
import * as Effect from "effect/Effect";
import { withTmpDir } from "./utilities.ts"; // packages/tools/test/utilities.ts
import { mockToolCall, runToolkit } from "./utilities.ts"; // packages/harness/test/utilities.ts

// Handler-direct: call the handler, assert on the returned Effect.
it.effect("edit rewrites the file in place", () =>
  withTmpDir("edit", (dir) =>
    Effect.gen(function* () {
      // ... write a file, call editHandler, assert contents
    }),
  ),
);

// Toolkit-via-mock: script the model, run through generateText.
it.effect("toolkit dispatches a read call and reports its output", () =>
  runToolkit({
    prompt: "read foo.txt",
    parts: [mockToolCall("read", { path: "/tmp/foo.txt" })],
  }).pipe(Effect.tap((result) => Effect.sync(() => expect(result.text).toContain("hello")))),
);
```

- Use `it.effect(...)` from `@effect/vitest`, **not** plain `it(...)`. It runs the returned Effect for you.
- Use `withTmpDir` / `withTmpFile` from `packages/tools/test/utilities.ts` for filesystem tests — they clean up via `Effect.acquireUseRelease` even on failure. Do **not** call `fs.mkdtempSync` directly. (`harness` and `tui` each have a sibling `test/utilities.ts` that duplicates or re-exports what they need — per-package on purpose, no shared `test-utils` workspace.)
- For failure assertions use `Effect.either` + `expectLeft(result, "ExpectedTag")` from `packages/tools/test/utilities.ts`. Don't try/catch tagged errors.
- Mock model responses with `mockText` and `mockToolCall` — they produce the kebab-case `Response.PartEncoded` shape `@effect/ai` expects, not pi's camelCase.
- **CRITICAL**: Do not write flaky tests. Do not use `setTimeout`. `await` the condition, not the clock.

## Code review self-check

- Before writing code that makes a non-obvious choice, pre-emptively ask "why this and not the alternative?" If you can't answer, research until you can — don't write first and justify later.
- If neighboring code does something differently than you're about to, find out _why_ before deviating. Its choices are often load-bearing, not stylistic.
- Don't take a bug report's suggested fix at face value — verify it's the right layer.
- Effect machinery is the right answer for control flow, error handling, and resource management in this repo. If you're reaching for try/catch or raw promises in `packages/*/src/`, step back and check the existing patterns first.

## Important development notes

1. **The `docs/index.md` vault map is injected at session start** by `inject-docs.sh`, so it's already in your context — but it lists files you still need to open.
2. **Run `bun run check` before declaring done.** Typecheck, lint, format, and tests must all pass.
3. **All changes must be tested.** Add a handler-direct test for tool behavior, a toolkit-level test if it affects dispatch.
4. **Follow neighboring patterns.** Check the sibling tool file before adding a new one. `Tool.make` spec + handler function — same shape every time.
5. **Do not edit `repos/`.** Vendored source is read-only reference material.
6. **Do not hand-edit `docs/index.md`.** It is auto-rebuilt by the `auto-index-docs.sh` PostToolUse hook — a bare wikilink map, no descriptions. Curated narrative lives in `docs/overview.md` and topic files.
7. **Use absolute paths** in tool calls and tests.
8. **`@effect/ai` gotchas are documented.** Before debugging weird Effect/AI behavior, scan `docs/patterns/effect-ai-gotchas.md` — `failureMode: "return"`, Layer scoping, and the internal turn loop have all caught us already.
9. **Be humble and honest.** Never overstate what works in commits, PRs, or messages to the user.

## Persistent memory: `docs/`

`docs/` doubles as the project wiki **and** the agent's long-term memory. Treat it as the vault — read first, write after corrections or notable learnings.

- **Vault map.** `docs/index.md` is auto-rebuilt by `auto-index-docs.sh` from filesystem state — bare `[[wikilinks]]` grouped by top-level directory. Do not hand-edit.
- **Curated landing.** `docs/overview.md` holds the "start here, in order" reading list and reference-repo notes. Edit when a new entry deserves prominent mention.
- **Plans.** `docs/plans/` holds phased implementation plans (one directory per plan with `overview.md` + phase files, or a single file).
- **Write after learnings.** Mistakes, corrections, gotchas, non-obvious decisions → route to the right place: principle (`docs/principles/`), gotcha (`docs/patterns/`), recipe (`docs/guides/`), backlog item (`docs/backlog.md`), or skill update (`.agents/skills/<skill>/`).
