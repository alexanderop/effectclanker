# effectclanker

A learning-grade coding harness built on [Effect-TS](https://effect.website)
and [`@effect/ai`](https://effect.website/docs/ai/introduction). The project
exists to learn Effect by reading the OpenAI Codex source and reproducing
its patterns in TypeScript. It is not a polished product.

The harness wires six tools (`read`, `write`, `edit`, `shell`, `grep`,
`glob`) into an Anthropic-backed `LanguageModel`. You give it a prompt; it
calls tools until it has an answer.

---

## Start here, in order

1. **[[architecture]]** — the three layers (`Tool`, `Toolkit`,
   `LanguageModel`), where each one lives, how a prompt becomes a response.
2. **[[tooling]]** — Bun, Vitest, oxlint, oxfmt, TypeScript. What
   `bun run check` actually does.
3. **[[guides/adding-a-tool]]** — the recipe. The most common task in
   this codebase.
4. **[[testing-strategy]]** — the pyramid: why we don't hit real LLMs
   in CI, what each tier tests, how this mirrors `pi` and `codex`. Read
   this _before_ the mechanics doc below.
5. **[[guides/testing]]** — `it.effect`, the `withLanguageModel` mock,
   handler-direct vs toolkit-via-mock test styles,
   `Effect.acquireUseRelease` for tmp dirs.
6. **[[patterns/effect-ai-gotchas]]** — three non-obvious things that
   bit us. Read once; refer back when something breaks unexpectedly.

---

## Reference repositories

`repos/effect/`, `repos/codex/`, and `repos/pi/` are vendored as git
subtrees. Treat as **read-only**. When in doubt about an `@effect/*`
API, how Codex does X, or how `pi` solves a similar agent-harness
problem, read the source there instead of guessing or asking an LLM.
The squashed upstreams live at:

- `repos/effect/` ← https://github.com/Effect-TS/effect
- `repos/codex/` ← https://github.com/openai/codex.git
- `repos/pi/` ← https://github.com/earendil-works/pi.git

This is also why the linters and formatters carry explicit `repos/**`
ignore patterns — see [[tooling]].

### Reference notes distilled from `repos/`

- **[[patterns/pi-api-key-resolution]]** — three-layer priority (CLI
  override → `auth.json` → env var) and the `!cmd` / env-name / literal
  indirection in the `key` field. Read before designing multi-provider
  auth.
- **[[patterns/oxlint-effect-rules]]** — 9 project-local rules ported
  from `mikearnaldi/accountability`, wired through oxlint's
  ESLint-v9-compatible `jsPlugins` API. Where the rules live and the
  gotchas (deprecated `getSourceCode`, string coercion for `data`,
  helper hoisting).

---

## Quick orientation by file

| Path                   | What it is                                                                     |
| ---------------------- | ------------------------------------------------------------------------------ |
| `src/tools/*.ts`       | One file per tool. Each exports a `Tool.make` spec and a handler function.     |
| `src/toolkit.ts`       | `Toolkit.make(...)` of all tools, plus `.toLayer({...})` wiring handlers.      |
| `src/cli.ts`           | `@effect/cli` entry point. Wires `AnthropicClient` + `AnthropicLanguageModel`. |
| `src/index.ts`         | Library barrel exports.                                                        |
| `test/utilities.ts`    | Mirror of `@effect/ai`'s `withLanguageModel` test helper.                      |
| `test/tools/*.test.ts` | Handler-direct tests (one per tool).                                           |
| `test/toolkit.test.ts` | End-to-end tests through `generateText` with a mock model.                     |
| `repos/`               | Read-only vendored source.                                                     |
| `docs/`                | This vault.                                                                    |
