# Agents file injection

## Goal

Read at most one **Agents file** (`AGENTS.md` preferred, `CLAUDE.md`
fallback) from the current working directory at session start, and embed
its contents in the cached system prompt inside a
`<project_instructions source="…">` block — between `<env>` and
`<available_skills>`. Frozen for the session; edits require restarting
the chat. See `CONTEXT.md` for the term definition and
`docs/adr/0004-agents-file-discovery-is-cwd-only.md` for the
discovery-scope rationale.

Pattern reference (each ref repo made different choices; ours is the
narrowest synthesis):

- `repos/codex/codex-rs/core/src/agents_md.rs` — codex walks ancestors
  to a `.git` marker and concatenates every `AGENTS.md` found. We do
  not walk.
- `repos/opencode/packages/opencode/src/session/instruction.ts` —
  opencode reads global (`~/.config/opencode/AGENTS.md` and
  `~/.claude/CLAUDE.md`) plus project, with first-filename-wins
  per scope. We skip global.
- `repos/pi/packages/coding-agent/src/core/resource-loader.ts`
  (`loadProjectContextFiles`) — pi reads global plus walks all
  ancestors. We skip global, no walk.

## Requirements

### Discovery

- New module
  `/Users/alexanderopalic/Projects/effectclanker/packages/harness/src/agents-file.ts`
  exports:

  ```ts
  export interface AgentsFileInfo {
    readonly source: string; // absolute path
    readonly content: string; // file body, untrimmed-from-end, no envelope
  }

  export const loadAgentsFile = (
    cwd: string,
  ): Effect.Effect<AgentsFileInfo | undefined>;
  ```

- Discovery is a **plain Effect-returning function**, not a `Context.Tag`
  / `Layer`. One consumer (the system prompt). Layer machinery would be
  premature — see Q6 reasoning in the design grilling.

- File lookup order in `cwd`:
  1. `path.join(cwd, "AGENTS.md")`
  2. `path.join(cwd, "CLAUDE.md")` — only if AGENTS.md is absent

  First match wins. No same-directory stacking.

- Treat as absent (return `undefined`) when:
  - Neither file exists.
  - The matched file exists but its trimmed content is empty.

- The returned `content` is the raw file body (utf-8). Trimming for the
  empty-check happens against a temporary copy; the embedded body
  preserves the user's leading/trailing whitespace as-is so list
  formatting / code fences round-trip.

- The returned `source` is the **absolute** path of the matched file.
  Resolve via `path.resolve(cwd, "AGENTS.md")` etc. Do not convert to
  `file://` URL — `<env>` already uses bare paths and the
  `<project_instructions source="…">` block matches that style. (Skills'
  `<location>` is a `file://` URL because opencode does it that way; we
  keep that one anomaly contained.)

- I/O failures other than `ENOENT` propagate as Effect failures. The
  caller in `runChatApp` / `runCommand` should treat them as fatal —
  bad disk is not something to silently swallow at session start. Use
  `fs.promises.readFile` via Effect's `Effect.tryPromise` (matches the
  pattern in `packages/tools/src/read.ts`).

### System-prompt injection

- Extend
  `/Users/alexanderopalic/Projects/effectclanker/packages/harness/src/system-prompt.ts`:

  ```ts
  export interface EnvironmentInfo {
    readonly cwd: string;
    readonly platform: string;
    readonly date: Date;
    readonly agentsFile?: AgentsFileInfo; // NEW, optional
    readonly skills?: ReadonlyArray<SkillInfo>;
  }
  ```

- When `env.agentsFile === undefined`: today's exact output (env
  block, optionally followed by `<available_skills>`). No trailing
  whitespace change. Existing tests stay byte-equal.

- When `env.agentsFile` is set: append a blank line after `</env>`,
  then:

  ```
  <project_instructions source="/abs/path/AGENTS.md">
  …raw content of the Agents file…
  </project_instructions>
  ```

  Then (if applicable) the blank line + `<available_skills>` block as
  today. Order is fixed: `<env>` → `<project_instructions>` →
  `<available_skills>` → explanation line.

- The XML wrapper attributes use double quotes. The `source` value is
  the absolute path verbatim — we trust it because it came from
  `path.resolve(cwd, …)`. No XML escaping is required for filesystem
  paths in practice, but if the path contains a `"` character we replace
  it with `&quot;`. (This is paranoia; macOS and Linux both allow it but
  no real project has it.)

- The body between the open and close tags is the file content
  verbatim. We do **not** strip trailing newlines from the file — the
  closing `</project_instructions>` may end up on the same line as a
  trailing-newline-less file; that's fine, XML doesn't require it on
  its own line.

- `chatWithEnvironment(env)` accepts the same optional `agentsFile`
  field and threads it into the builder via `EnvironmentInfo`.

### Threading

- `runChatApp` in
  `/Users/alexanderopalic/Projects/effectclanker/packages/tui/src/chat-runtime.tsx:21`
  calls `loadAgentsFile(cwd)` (alongside the existing `Skills` yield)
  and passes the result into `chatWithEnvironment({ cwd, platform,
date, agentsFile, skills: skills.all })`.

- `runCommand` in
  `/Users/alexanderopalic/Projects/effectclanker/packages/cli/src/cli.ts:79`
  does the same in the single-shot path.

- No mid-session re-read. `/clear` resets history but does **not**
  re-discover the Agents file — same out-of-scope decision as
  `specs/pending/skills.md` (Mid-session skill reload).

### Re-exports

- `/Users/alexanderopalic/Projects/effectclanker/packages/harness/src/index.ts`
  re-exports: `AgentsFileInfo`, `loadAgentsFile`.

## Implementation hints

- The function reads at most two files (`AGENTS.md`, `CLAUDE.md`) and
  short-circuits on the first hit. Use `fs.promises.readFile(path,
"utf8")` with a single `Effect.tryPromise` per attempt; convert
  `ENOENT` to "try the next candidate" by catching the tagged error and
  recovering with `Effect.succeed(undefined)`. See
  `packages/tools/src/read.ts` for the reference pattern.

- `path.resolve(cwd, "AGENTS.md")` returns an absolute path even when
  `cwd` is already absolute. No `path.join` — `resolve` normalizes and
  guarantees absolute, which is the contract.

- For tests, use `withTmpDir` from
  `packages/harness/test/utilities.ts` (or its sibling) to stage a
  temporary cwd with the Agents file present/absent.

- The system-prompt extension is a pure string-concat — same shape as
  the existing `<available_skills>` injection. Reuse the
  `buildSkillsBlock`-style helper structure.

- **Reference XML wrapper shape:** there is no direct opencode/codex
  precedent for `<project_instructions>`. Codex puts the content in a
  separate protocol field; opencode prefixes with plain
  `Instructions from: <path>` and relies on system-message-array
  boundaries. Our XML wrapper is the synthesis that fits our
  single-cached-system-message model (ADR-0002).

- **Agents file vs Skill:** they are not the same concept. Agents file
  = always-on instructions baked into the system prompt; Skill =
  reactive workflow loaded on demand via the `skill` tool. CONTEXT.md
  has a relationship line distinguishing them.

## Acceptance criteria

TDD order — write the first test, watch it fail, then make it pass.
Then the next.

### Discovery

- [ ] **Red:** `packages/harness/test/agents-file.test.ts` →
      `it.effect("loads AGENTS.md from cwd when present", ...)`.
      `withTmpDir` stages `<dir>/AGENTS.md` with body `hello agents`.
      Asserts `loadAgentsFile(dir)` returns
      `{ source: <abs path to AGENTS.md>, content: "hello agents" }`.
- [ ] **Green:** same test passes after `loadAgentsFile` exists.
- [ ] `it.effect("falls back to CLAUDE.md when AGENTS.md absent", ...)`
      — only `CLAUDE.md` present. Returns `source` pointing at
      `CLAUDE.md`, `content` from it.
- [ ] `it.effect("AGENTS.md wins when both files exist", ...)`
      — both files present with distinct bodies. Returns AGENTS.md's
      body and source. CLAUDE.md is not read.
- [ ] `it.effect("returns undefined when neither file exists", ...)`
      — empty tmpdir.
- [ ] `it.effect("returns undefined when AGENTS.md is whitespace-only", ...)`
      — `"   \n\n"` is treated as absent. CLAUDE.md is not used as a
      fallback in this case (the matched file existing-but-empty is
      not the same as missing — see Out of scope).
- [ ] `it.effect("source is absolute even when cwd is relative", ...)`
      — pass a relative `cwd`. Asserts `path.isAbsolute(result.source)`.

### System-prompt injection

- [ ] `it.effect("omits <project_instructions> when agentsFile is undefined", ...)`
      — output byte-equal to today's `buildEnvironmentSystemPrompt`
      output. Existing tests stay untouched.
- [ ] `it.effect("appends <project_instructions> after env, before skills", ...)`
      — pass both `agentsFile` and a non-empty `skills` array. Output
      contains `</env>\n\n<project_instructions source=` followed by
      `</project_instructions>\n\n<available_skills>`.
- [ ] `it.effect("renders <project_instructions> when no skills", ...)`
      — `agentsFile` set, `skills` undefined. Output ends after the
      `</project_instructions>` line; no skills tail.
- [ ] `it.effect("source attribute uses the absolute path verbatim", ...)`
      — pass `agentsFile: { source: "/tmp/x/AGENTS.md", content: "" }`.
      Output contains `source="/tmp/x/AGENTS.md"`.
- [ ] `it.effect("body is the file content verbatim", ...)`
      — content includes leading/trailing whitespace, code fences,
      tabs. Asserts the embedded body is character-equal to the input.

### Threading smoke

- [ ] `packages/cli/src/cli.ts:79` and
      `packages/tui/src/chat-runtime.tsx:21` both call
      `loadAgentsFile(cwd)` and pass the result to
      `chatWithEnvironment`. Smoke check by reading the diff — no
      runtime test required (the pure unit tests above cover the
      shape; this is just wiring).

### Repo hygiene

- [ ] No `setTimeout`, no real LLM calls, no flaky waits.
- [ ] `bun run check` passes (typecheck, lint, format, tests).

## Out of scope

- **Ancestor walking** (codex). The harness's own monorepo has one
  `CLAUDE.md` at the root; per-package context files don't exist.
  Add walking when a real per-package Agents file emerges. Locked by
  `docs/adr/0004-agents-file-discovery-is-cwd-only.md`.
- **Global Agents file** (`~/.claude/AGENTS.md` or
  `~/.config/effectclanker/AGENTS.md`). No global today; revisit when
  a real cross-project rule needs to ride along.
- **Stacking same-dir AGENTS.md + CLAUDE.md.** AGENTS.md wins; CLAUDE.md
  is the fallback only.
- **Mid-session reload.** Frozen at session start. Restart to pick up
  edits. `/clear` does not re-read. Mirrors skills.
- **Whitespace-only file → CLAUDE.md fallback.** If `AGENTS.md` exists
  but is empty/whitespace, the result is `undefined`; we do **not**
  then try `CLAUDE.md`. The presence of a file (even empty) signals
  user intent to use AGENTS.md; falling through would mask
  intentional silencing.
- **Byte-budget truncation** (codex's `project_doc_max_bytes`). With
  cwd-only and one file, untruncated. Add a cap if a real Agents file
  ever blows the cache budget.
- **Live `file://` URL in `source`.** Bare absolute path. Skills' XML
  uses `file://` URLs because opencode does; we don't propagate that
  here.
- **`<project_instructions>` reading from anywhere other than the
  cached system message.** No per-turn injection, no
  `<system-reminder>`-style retransmission. ADR-0002 single-breakpoint
  caching is preserved.
- **Per-agent permission filtering** (opencode's `Permission.disabled`
  on skills). No agent concept here; the Agents file is universal.
- **Bash backtick substitution / template rendering.** Content is
  injected verbatim. No `$ARGUMENTS` semantics — that's a Skill thing.
- **Watcher-based reload.** No `chokidar`. Restart to refresh.
