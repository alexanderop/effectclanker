# effectclanker

A learning-grade coding harness built on [Effect-TS](https://effect.website)
and [`@effect/ai`](https://effect.website/docs/ai/introduction). The project
exists to learn Effect by reading the OpenAI Codex source and reproducing
its patterns in TypeScript. It is not a polished product.

The harness wires six tools (`read`, `write`, `edit`, `bash`, `grep`,
`glob`) into an Anthropic-backed `LanguageModel`. You give it a prompt; it
calls tools until it has an answer.

---

## Start here, in order

1. **[Architecture](./architecture.md)** — the three layers (`Tool`,
   `Toolkit`, `LanguageModel`), where each one lives, how a prompt becomes
   a response.
2. **[Tooling & the `check` pipeline](./tooling.md)** — Bun, Vitest,
   oxlint, oxfmt, TypeScript. What `bun run check` actually does.
3. **[Adding a new tool](./guides/adding-a-tool.md)** — the recipe. The
   most common task in this codebase.
4. **[Testing with Effect](./guides/testing.md)** — `it.effect`, the
   `withLanguageModel` mock, handler-direct vs toolkit-via-mock test
   styles, `Effect.acquireUseRelease` for tmp dirs.
5. **[`@effect/ai` gotchas](./patterns/effect-ai-gotchas.md)** — three
   non-obvious things that bit us. Read once; refer back when something
   breaks unexpectedly.

---

## Reference repositories

`repos/effect/` and `repos/codex/` are vendored as git subtrees. Treat as
**read-only**. When in doubt about an `@effect/*` API or how Codex does X,
read the source there instead of guessing or asking an LLM. The squashed
upstream lives at:

- `repos/effect/` ← https://github.com/Effect-TS/effect
- `repos/codex/` ← https://github.com/openai/codex.git

This is also why the linters and formatters carry explicit `repos/**`
ignore patterns — see [tooling](./tooling.md).

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
| `docs/`                | This wiki.                                                                     |
