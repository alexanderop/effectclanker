# Backlog

Prioritized list of the 10 biggest gaps between this Effect-TS harness and the
real OpenAI Codex CLI. Each epic cites concrete source paths under
`repos/codex/` so an implementer can read the reference implementation before
designing the Effect-TS port. Stories under each epic are scoped to be
independently grabbable — pick one, ship it, leave the rest of the epic open.

Epics are ordered roughly by impact on harness behavior. The early ones unblock
multiple downstream epics (sandbox → safe local-dev; rollout → resume/compact;
streaming → TUI), so prefer top-to-bottom unless a downstream task is small and
isolated.

Today the harness has: 8 tools (`read`, `write`, `edit`, `apply_patch`, `shell`,
`grep`, `glob`, `update_plan`), an `ApprovalPolicy` service (auto / interactive
/ deny) and a `PlanStore`. Everything below is missing.

## Epic 1: Sandboxed shell execution

**Codex source:** `repos/codex/codex-rs/sandboxing/src/lib.rs`,
`repos/codex/codex-rs/sandboxing/src/seatbelt.rs`,
`repos/codex/codex-rs/sandboxing/src/landlock.rs`,
`repos/codex/codex-rs/core/src/safety.rs`

**Why:** the harness `shell` tool spawns commands directly via Effect's
`CommandExecutor` with zero filesystem or network restriction — every approval
mode but `deny` lets the model execute arbitrary code as the user. Codex wraps
every shell call in a platform sandbox (Seatbelt on macOS, Landlock+bwrap on
Linux) with a workspace-scoped writable root and a network-off default. Without
this, "auto-approve" is unsafe outside throwaway environments, which limits how
much agency we can responsibly grant the model.

### Stories

- **[Story 01 — Sandbox service skeleton](./stories/01-sandbox-service-skeleton/index.md)** —
  Add a `Sandbox` Effect service with a `run(command, policy)` API and a
  no-op default layer so existing tests stay green; mirror the
  `SandboxPolicy` enum from `sandboxing/src/lib.rs` (`ReadOnly`,
  `WorkspaceWrite`, `DangerFullAccess`).
- Implement a macOS Seatbelt backend layer that wraps `shell` in
  `sandbox-exec -p <profile>`, porting the deny-by-default policy snippets
  from `sandboxing/src/seatbelt_base_policy.sbpl` and
  `seatbelt_network_policy.sbpl`.
- Implement a Linux Landlock/bwrap backend layer, modeled on
  `sandboxing/src/landlock.rs` and `sandboxing/src/bwrap.rs`, and wire it
  into `shellHandler` so `--approval auto` only runs sandboxed.
- Add a `--sandbox` CLI option (`read-only`/`workspace-write`/`danger`)
  exposed in `src/cli.ts` that selects the corresponding sandbox layer.

## Epic 2: Session rollout and resume

**Codex source:** `repos/codex/codex-rs/rollout/src/recorder.rs`,
`repos/codex/codex-rs/rollout/src/lib.rs`,
`repos/codex/codex-rs/core/src/rollout.rs`

**Why:** each `bun src/cli.ts run` invocation is amnesiac — no transcript, no
resume, no way to inspect what the model did after the process exits. Codex
appends every turn (user input, tool calls, tool results, model deltas) to a
JSONL rollout file under `~/.codex/sessions`, then lets the user resume by ID.
For a learning harness this also doubles as a free debugger: you can read the
exact serialized history that was sent to the model.

### Stories

- Define a `Rollout` Effect service with `append(event)` and `replay(id)`,
  using the line format from `rollout/src/recorder.rs` (one JSON object per
  line, header item first).
- Implement a filesystem `RolloutLayer` that writes to
  `~/.effectclanker/sessions/<uuid>.jsonl` and reads on startup, plus a
  no-op layer for tests.
- Add `--resume <session-id>` and `--continue` (resume most recent) flags
  to the `run` CLI command, replaying recorded user/assistant messages
  into the next `LanguageModel.generateText` call.
- Surface a `harness sessions list` subcommand that reads metadata
  (cwd, model, started-at) from the rollout header — see
  `rollout/src/metadata.rs` for the fields to store.

## Epic 3: Streaming model output

**Codex source:** `repos/codex/codex-rs/core/src/client.rs`,
`repos/codex/codex-rs/core/src/client_common.rs`,
`repos/codex/codex-rs/core/src/stream_events_utils.rs`

**Why:** the harness calls `LanguageModel.generateText`, which blocks until
the entire response is materialized. The user stares at a blank terminal for
the duration of a long turn. Codex consumes the model SSE stream and renders
deltas as they arrive — text, reasoning, tool-call arguments — so the user
sees progress. Streaming is also a prerequisite for any interactive TUI
(Epic 10) and for live progress on long-running tools.

### Stories

- Swap `LanguageModel.generateText` for `LanguageModel.streamText` (or the
  current `@effect/ai` equivalent — confirm against `repos/effect`) and
  build a `Stream<AssistantEvent>` consumer in `src/cli.ts`.
- Render text deltas with `Console.log` and tool-call deltas as
  `tool_call(partial)` lines, matching the event-mapping behavior in
  `core/src/stream_events_utils.rs`.
- Add a `--stream/--no-stream` flag (default on) so tests can opt out and
  get a deterministic single-shot response.
- Document the streaming dataflow in `docs/architecture.md` so it sits
  alongside the existing prompt → tool-call diagram.

## Epic 4: Context compaction

**Codex source:** `repos/codex/codex-rs/core/src/compact.rs`,
`repos/codex/codex-rs/core/src/context_manager/mod.rs`,
`repos/codex/codex-rs/core/src/context_manager/history.rs`

**Why:** the harness has no notion of conversation history, let alone a way
to keep it inside the model's context window. Codex tracks token usage,
detects when history is close to the cap, and runs a "compact" turn that
asks the model to summarize earlier messages so the conversation can
continue. Without this, multi-turn use (Epic 2's resume) will silently
overflow on any long-running task.

### Stories

- Add a `History` Effect service that stores typed turn items and exposes
  `tokenEstimate()` — mirror the data shape in
  `core/src/context_manager/history.rs`.
- Implement a compaction routine driven by an `Effect.if`-style threshold
  on `tokenEstimate()`, modeled on the prompt and orchestration in
  `core/src/compact.rs`.
- Wire compaction into the resume path from Epic 2 so resumed sessions
  load a compacted summary instead of the full transcript when the
  rollout exceeds the window.
- Expose a manual `harness compact` CLI command so users can force-compact
  the active session for debugging.

## Epic 5: Allowlist-based approval policy

**Codex source:** `repos/codex/codex-rs/execpolicy/src/lib.rs`,
`repos/codex/codex-rs/core/src/exec_policy.rs`,
`repos/codex/codex-rs/core/src/safety.rs`

**Why:** today's three-option approval (`auto`/`interactive`/`deny`) is too
coarse — every `shell` call either runs without asking or pauses for y/N.
Codex maintains a per-session set of approved command prefixes (`git`,
`ls`, `cargo build`…) and an execpolicy DSL for "always allow", "ask once",
"never". This is the difference between an agent that pauses 40 times per
task and one that pauses 4 times.

### Stories

- Add `approve-once` and `approve-session` outcomes to
  `ApprovalPolicyService` (today only `approved`/`rejected`) and persist
  the session allowlist in a new `CommandAllowlist` service, mirroring
  the in-memory model in `core/src/exec_policy.rs`.
- Port the execpolicy starlark-ish rule DSL from `execpolicy/src/rule.rs`
  to a typed Effect Schema `CommandRule` and load rules from
  `~/.effectclanker/policy.toml`.
- Extend `ApprovalInteractiveLayer` to render four options
  (approve / approve-once / approve-session / reject) and stash session
  approvals via the new service.
- Add a "trusted-projects" check (see `safety.rs::is_trusted_project`)
  that auto-approves git-tracked workspace edits when running inside a
  trusted root.

## Epic 6: MCP client and server

**Codex source:** `repos/codex/codex-rs/mcp-server/src/lib.rs`,
`repos/codex/codex-rs/core/src/mcp.rs`,
`repos/codex/codex-rs/mcp-server/src/codex_tool_runner.rs`

**Why:** Codex both _exposes_ itself as an MCP server (so other agents can
call it) and _consumes_ external MCP servers (so the user can plug in any
MCP-compatible tool — fetch, git, filesystem, etc.). The harness has
neither half. MCP is the ecosystem standard for tool plug-in, and
supporting it makes every third-party MCP server available as a
harness tool for free.

### Stories

- Add an `McpClient` service that connects to a configured MCP server
  over stdio, calls `tools/list`, and registers the returned tools into
  `HarnessToolkit` dynamically — see the discovery flow in
  `core/src/mcp.rs`.
- Map MCP tool calls to Effect-AI `Tool` definitions, translating the
  JSON-schema input shapes the way `mcp-server/src/codex_tool_config.rs`
  does in reverse.
- Read MCP server entries from a new `mcp_servers` table in the harness
  config (`~/.effectclanker/config.toml`), modeled on
  `repos/codex/codex-rs/config/src/mcp_edit.rs`.
- Add a `harness serve mcp` subcommand that exposes the existing harness
  toolkit over MCP stdio, mirroring `mcp-server/src/main.rs`.

## Epic 7: Hooks system

**Codex source:** `repos/codex/codex-rs/hooks/src/lib.rs`,
`repos/codex/codex-rs/core/src/hook_runtime.rs`,
`repos/codex/codex-rs/hooks/src/registry.rs`

**Why:** Codex lets users hook into lifecycle events (pre-tool, post-tool,
session-start, session-end, on-prompt) to run arbitrary scripts —
formatters after edits, lint after `shell`, custom logging, notifications.
The harness has no extension point: every customization requires editing
TypeScript and recompiling. Hooks turn the harness into a platform.

### Stories

- Define a `Hooks` Effect service with `run(event, payload)` returning a
  decision (`continue`/`block`/`replace`), mirroring the dispatch contract
  in `hooks/src/registry.rs`.
- Implement `PreToolUse` and `PostToolUse` hook points around every
  handler in `src/toolkit.ts` so a hook can short-circuit a tool call or
  rewrite its result, matching `core/src/hook_runtime.rs`.
- Load hook declarations from `~/.effectclanker/hooks.toml` using the
  schema from `hooks/src/schema.rs` (matcher, command, timeout-ms).
- Add a `SessionStart` hook fired from `src/cli.ts` so users can preload
  workspace context (e.g. `git status`) into the first prompt.

## Epic 8: Workspace mentions and file search

**Codex source:** `repos/codex/codex-rs/file-search/src/lib.rs`,
`repos/codex/codex-rs/core/src/mention_syntax.rs`,
`repos/codex/codex-rs/file-search/src/cli.rs`

**Why:** Codex lets the user write `@src/foo.ts` in a prompt and silently
inlines the file's contents (or a search result) before the prompt hits
the model. The harness forwards the prompt string untouched, so the user
has to ask the model to read each file via the `read` tool — wasting a
round-trip per reference. Mentions are the cheapest way to get relevant
context into the first turn.

### Stories

- Port the `@path` and `@symbol` mention parser from
  `core/src/mention_syntax.rs` to an Effect Schema decoder that returns
  a list of resolved mentions plus the cleaned prompt.
- Build a `FileSearch` Effect service backed by ripgrep
  (`bun x rg --json`), inspired by the streaming index in
  `file-search/src/lib.rs`, returning ranked file paths.
- In the `run` command, expand each mention before calling
  `LanguageModel.generateText`: file mentions become inlined content,
  symbol mentions become ripgrep hit summaries.
- Add a `harness search <query>` CLI subcommand that exposes the
  `FileSearch` service standalone, matching `file-search/src/cli.rs`.

## Epic 9: Skills and agent personas

**Codex source:** `repos/codex/codex-rs/skills/src/lib.rs`,
`repos/codex/codex-rs/core/src/skills.rs`,
`repos/codex/codex-rs/core/src/agent/registry.rs`

**Why:** Codex bundles "skills" — reusable instruction packs (e.g.
"pr-reviewer", "release-notes-writer") that the user can invoke per-turn —
and an "agents" registry that lets a parent agent delegate subtasks to
specialized child agents with their own toolkits and system prompts. The
harness has one toolkit and one system prompt baked in. Skills + agents
are how Codex scales from one model to a workflow.

### Stories

- Add a `Skill` Effect schema (name, description, prompt template,
  required tools) and a `SkillRegistry` service that loads skills from
  `~/.effectclanker/skills/*.md`, modeled on `skills/src/lib.rs`.
- Inject the active skill's prompt into `LanguageModel.generateText`'s
  system instructions when the user runs
  `harness run --skill <name> "<prompt>"`.
- Define a `subagent` tool that spawns a nested `LanguageModel.generateText`
  call with a different toolkit and an isolated `PlanStore`, mirroring
  the delegation pattern in `core/src/agent/registry.rs`.
- Add a sample built-in skill (`pr-summary`) under `src/skills/` and
  document the install flow in `docs/guides/`.

## Epic 10: Interactive TUI front-end

**Codex source:** `repos/codex/codex-rs/tui/src/lib.rs`,
`repos/codex/codex-rs/tui/src/chatwidget.rs`,
`repos/codex/codex-rs/tui/src/app.rs`

**Why:** the harness is one-shot — type a prompt, get a single response,
exit. Codex ships a ratatui-based TUI with a multi-turn chat, slash
commands, live tool-call rendering, approval popups, and a transcript
pager. Even a minimal Effect-driven TUI would change the harness from
"demo runner" to "actually usable for real work". Depends on streaming
(Epic 3) and rollout (Epic 2).

### Stories

- Add an `Ink` (React-for-CLI) front-end behind a new `harness chat`
  subcommand that renders streaming events as they arrive — the
  layout model in `tui/src/chatwidget.rs` is the reference for the
  message + composer + status-line split.
- Wire interactive approval into the TUI: when `ApprovalInteractiveLayer`
  fires, surface a modal in the chat instead of reading stdin, matching
  the approval flow in `tui/src/bottom_pane/`.
- Implement a minimal slash-command set (`/clear`, `/compact`, `/help`,
  `/sessions`) inspired by `tui/src/slash_command.rs`, dispatching to
  the services built in Epics 2 and 4.
- Add keybindings for "scroll transcript" and "cancel current turn" via
  `Effect.race` against the model stream, mirroring the keymap in
  `tui/src/keymap.rs`.
