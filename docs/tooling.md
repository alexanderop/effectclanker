# Tooling & the `check` pipeline

## The stack

| Tool           | Used for                                      | Why                                                                                                |
| -------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Bun**        | Package manager + script runner + CLI runtime | Fastest install + good TS support. We use it for `bun install`, `bun run X`, and `bun src/cli.ts`. |
| **Node**       | Runtime for tests (via Vitest)                | Vitest is officially Node-targeted; Bun-runtime support is experimental.                           |
| **TypeScript** | Static type-checking                          | `tsc --noEmit`. Config is Bun's recommended strict preset.                                         |
| **oxlint**     | Linting                                       | Rust-based, ~100× faster than ESLint. Zero-config friendly.                                        |
| **oxfmt**      | Formatting                                    | Same family as oxlint. Prettier-compatible style.                                                  |
| **Vitest**     | Test runner                                   | `@effect/vitest` adds `it.effect(...)` for Effect-aware tests.                                     |

All four checkers are wired into a single `bun run check`.

## The `check` pipeline

```
bun run check
  ├─ bun run typecheck   → tsc --noEmit
  ├─ bun run lint        → oxlint
  ├─ bun run format:check → oxfmt --check
  └─ bun run test         → vitest run
```

Pre-commit / pre-PR rule of thumb: `bun run check` must pass. If only
formatting fails, run `bun run format` (without `--check`) to autofix.

The four steps each run in <1s except tests (~700 ms for the current
suite); the whole pipeline lands under two seconds on a warm cache.

## Config file map

| File               | Owns                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json`     | Deps + scripts.                                                                                                                            |
| `tsconfig.json`    | Bun's recommended strict preset, plus `noUncheckedIndexedAccess`. `repos/` excluded.                                                       |
| `.oxlintrc.json`   | Lint rules. `_tag` allowlisted (Effect idiom). `repos/` ignored.                                                                           |
| `.oxfmtrc.json`    | Format ignore patterns. **`.oxfmtignore` does not work** — see [gotchas](./patterns/effect-ai-gotchas.md#oxfmt-does-not-read-oxfmtignore). |
| `vitest.config.ts` | Test file globs. `repos/` excluded.                                                                                                        |
| `.gitignore`       | Node/Bun ignore set.                                                                                                                       |

## Bun vs Node — why the split?

The project's runtime split is occasionally confusing:

- **`bun install`** — Bun is the package manager. Faster than npm/pnpm.
- **`bun run script`** — Bun executes the script. For `vitest`, it spawns
  the Vitest binary which then runs under Node.
- **`bun src/cli.ts`** — Bun runs the CLI directly under its own runtime.
  Works because we use `NodeRuntime.runMain` (which `@effect/platform-bun`
  re-exports identically) and `NodeContext.layer` (which works under Bun).

In short: Bun handles installs and invocations; Node handles Vitest; Bun
handles the CLI binary. If you ever try `bun vitest` and it breaks, that's
expected — use `bun run test` so the published vitest entrypoint runs
under Node.

## Installing the CLI globally (`clanker` / `effectclanker`)

`packages/cli/package.json` declares two bins (`clanker`, `effectclanker`),
both pointing at `./src/cli.ts`. To get them on PATH:

```
cd packages/cli && bun link
```

That single command both registers the workspace and symlinks the bins
into `~/.bun/bin/` (no separate `bun link @effectclanker/cli` step needed
when you only want global bins, not a project dep).

**Gotcha — the shebang is load-bearing.** `bun link` symlinks the bin
**source file directly**, so when the shell exec's `clanker` it reads
`./src/cli.ts` itself. Without `#!/usr/bin/env bun` on line 1, `/bin/sh`
tries to parse TypeScript and fails with `import: command not found`. The
file must also be `chmod +x`. Both conditions are already in place; just
remember if you ever clone the bin pattern into another package.

## Reference repos under `repos/`

Two vendored git subtrees:

```
repos/effect/   ← https://github.com/Effect-TS/effect (squashed)
repos/codex/    ← https://github.com/openai/codex.git (squashed)
```

These are **read-only reference material**. Do not edit. Three tools
explicitly ignore them via config:

- `tsconfig.json` `exclude`
- `.oxlintrc.json` `ignorePatterns`
- `.oxfmtrc.json` `ignorePatterns`
- `vitest.config.ts` `exclude`

When an `@effect/*` API isn't documented or you want to know exactly what
Codex does, read the source under `repos/` first. It's faster and more
authoritative than upstream docs or LLM training data.
