# effectclanker

A learning-grade coding harness built on [Effect-TS](https://effect.website)
and [`@effect/ai`](https://effect.website/docs/ai/introduction).

The project exists to learn Effect by reading the OpenAI Codex source and
reproducing its patterns in TypeScript. It is not a polished product.

The harness wires a small set of tools (`read`, `write`, `edit`, `bash`,
`grep`, `glob`, `apply-patch`, `update-plan`) into an Anthropic-backed
`LanguageModel`. You give it a prompt; it calls tools until it has an answer.

## Requirements

- [Bun](https://bun.sh) — package manager, script runner, CLI runtime
- Node.js — used by the test runner
- `ANTHROPIC_API_KEY` — required to invoke the harness (not needed for `--help`)

## Setup

```sh
bun install
export ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

```sh
# Run the harness against a prompt
bun src/cli.ts run "list the TypeScript files in src/"

# Pick a model
bun src/cli.ts run --model claude-sonnet-4-6 "..."

# Gate the bash tool behind an approval policy
bun src/cli.ts run --approval interactive "..."   # prompt y/N per call
bun src/cli.ts run --approval deny "..."          # reject every gated call
bun src/cli.ts run --approval auto "..."          # default

# CLI help (no API key required)
bun src/cli.ts --help
```

## Commands

| Command                | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `bun install`          | install deps                                          |
| `bun run check`        | full pipeline: typecheck → lint → format:check → test |
| `bun run typecheck`    | `tsc --noEmit`                                        |
| `bun run lint`         | `oxlint`                                              |
| `bun run format`       | `oxfmt` — writes fixes                                |
| `bun run format:check` | `oxfmt --check` — read-only                           |
| `bun run test`         | `vitest run` (one-shot)                               |
| `bun run test:watch`   | `vitest` (watch mode)                                 |

Run `bun run check` before declaring a change done.

## Stack

- **TypeScript** (strict) on **Bun**, with **Node** for tests
- **`@effect/ai`** + **`@effect/ai-anthropic`** — `LanguageModel`, `Tool`, `Toolkit`
- **`@effect/cli`** + **`@effect/platform-node`** — CLI and runtime
- **oxlint** + **oxfmt** — Rust-based lint and format
- **Vitest** + **`@effect/vitest`** — test runner with the `it.effect(...)` helper

## Project layout

| Path                   | What it is                                                                     |
| ---------------------- | ------------------------------------------------------------------------------ |
| `src/tools/*.ts`       | One file per tool. Each exports a `Tool.make` spec and a handler function.     |
| `src/toolkit.ts`       | `Toolkit.make(...)` of all tools, plus `.toLayer({...})` wiring handlers.      |
| `src/cli.ts`           | `@effect/cli` entry point. Wires `AnthropicClient` + `AnthropicLanguageModel`. |
| `src/services/`        | Cross-cutting services (approval policy, plan store).                          |
| `test/`                | Handler-direct tests and end-to-end toolkit tests.                             |
| `docs/`                | Wiki — start at `docs/index.md`.                                               |
| `repos/`               | Read-only vendored source for `effect` and `codex`.                            |

## Documentation

Start at **[`docs/index.md`](./docs/index.md)**. From there:

- [`docs/architecture.md`](./docs/architecture.md) — the three layers (`Tool` / `Toolkit` / `LanguageModel`) and the dataflow from prompt to response
- [`docs/tooling.md`](./docs/tooling.md) — deeper notes on the stack and the `check` pipeline
- [`docs/guides/adding-a-tool.md`](./docs/guides/adding-a-tool.md) — recipe for the most common task in this codebase
- [`docs/guides/testing.md`](./docs/guides/testing.md) — `it.effect`, the `withLanguageModel` mock, `Effect.either` for failure assertions
- [`docs/patterns/effect-ai-gotchas.md`](./docs/patterns/effect-ai-gotchas.md) — non-obvious things that will bite you

Coding agents should read [`AGENTS.md`](./AGENTS.md) first.
