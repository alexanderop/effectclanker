# effectclanker

> `CLAUDE.md` is a symlink to this file — edit `AGENTS.md` directly. The Edit tool refuses to write through symlinks.

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
- `repos/pi/` — https://github.com/earendil-works/pi.git @ main (squashed)

## Persistent memory: `docs/`

`docs/` doubles as the project wiki **and** the agent's long-term memory. Treat it as the vault — read first, write after corrections or notable learnings.

- **Read first.** `docs/index.md` is injected at session start by `inject-docs.sh`. Skim it, then read the files relevant to the task.
- **Principles.** `docs/principles.md` indexes engineering principles under `docs/principles/`. Refer back when planning, reviewing, or debugging.
- **Plans.** `docs/plans/` holds phased implementation plans (one directory per plan with `overview.md` + phase files, or a single file). `docs/plans/index.md` is auto-rebuilt by `auto-index-docs.sh` — do not hand-edit.
- **Write after learnings.** Mistakes, corrections, gotchas, non-obvious decisions → route to the right place: principle (`docs/principles/`), gotcha (`docs/patterns/`), recipe (`docs/guides/`), backlog item (`docs/backlog.md`), or skill update (`.agents/skills/<skill>/`).
- **Curated landing page.** `docs/index.md` is hand-maintained. Only edit when a new entry deserves a top-level mention.

### Skills

Slash commands installed under `.agents/skills/`:

- `/reflect` — manual deep pass over the conversation. Captures learnings into `docs/` or skill files. Complements the automatic Stop hook below.
- `/brain` — read/write conventions for the `docs/` vault.
- `/meditate` — audit `docs/` for staleness, redundancy, unstated principles.
- `/ruminate` — mine past Claude Code conversation history for uncaptured patterns.

### Hooks

- **SessionStart** (`inject-docs.sh`) — dumps `docs/index.md` and `docs/principles.md` so the agent sees the vault upfront.
- **PostToolUse** (`auto-index-docs.sh`) — rebuilds `docs/plans/index.md` on drift. Exits fast when nothing changed.
- **Stop** (`docs-reflection.sh`) — after meaningful sessions (≥5 tool calls), prompts the agent to consider whether anything is worth adding to `docs/`.
