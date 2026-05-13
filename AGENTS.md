# effectclanker

A learning-grade coding harness built on Effect-TS and `@effect/ai`.

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

| Command                         | What it does                                          |
| ------------------------------- | ----------------------------------------------------- |
| `bun install`                   | install deps                                          |
| `bun run check`                 | full pipeline: typecheck → lint → format:check → test |
| `bun run typecheck`             | `tsc --noEmit`                                        |
| `bun run lint`                  | `oxlint`                                              |
| `bun run format`                | `oxfmt` — writes fixes                                |
| `bun run format:check`          | `oxfmt --check` — read-only                           |
| `bun run test`                  | `vitest run` (one-shot)                               |
| `bun run test:watch`            | `vitest` (watch mode)                                 |
| `bun src/cli.ts run "<prompt>"` | invoke the harness — requires `ANTHROPIC_API_KEY`     |
| `bun src/cli.ts --help`         | CLI help — no API key required                        |

Run `bun run check` before declaring a change done.

## Before you change anything

Read **`docs/index.md`** first. It is the wiki landing page and links to:

- `docs/architecture.md` — how the three layers (`Tool` / `Toolkit` / `LanguageModel`) fit together, and the dataflow from prompt to response.
- `docs/guides/adding-a-tool.md` — recipe for the most common task in this codebase.
- `docs/guides/testing.md` — `it.effect`, the `withLanguageModel` mock, `Effect.either` for failure assertions.
- `docs/tooling.md` — deeper notes on the stack and the `check` pipeline.
- `docs/patterns/effect-ai-gotchas.md` — non-obvious things that will bite you (`failureMode: "return"`, Layer scoping, the internal turn loop).

Skim `index.md`, identify which docs are relevant to the task in front of you, then read those before touching code.

## Reference repositories

Source-of-truth code for libraries we depend on. Treat as **read-only reference material** — do not edit files under `repos/`. When asked about a library listed below, explore its source here first instead of guessing or relying on training data.

- `repos/effect/` — https://github.com/Effect-TS/effect @ main (squashed)
- `repos/codex/` — https://github.com/openai/codex.git @ main (squashed)
