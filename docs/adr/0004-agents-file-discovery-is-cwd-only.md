# Agents file discovery is cwd-only, no walking, no global

The harness reads at most one **Agents file** (`AGENTS.md` preferred,
`CLAUDE.md` fallback) from the current working directory. It does not
walk ancestor directories like codex (`agents_md.rs` walks up to a
`.git` marker, concatenating every match), and does not read a global
`~/.claude/AGENTS.md` like opencode (`session/instruction.ts:60-64`).

The Agents file is loaded once at session start and embedded in the
cached system prompt inside a `<project_instructions source="…">` block,
between `<env>` and `<available_skills>`. Same single-cacheControl
breakpoint as ADR-0002.

Rationale: a learning-grade harness with no monorepo subprojects of its
own doesn't earn the hierarchy, and there's no shared global context
across projects we want to ingest. If either need surfaces — a real
per-package AGENTS.md emerges in this codebase, or a global
"always include this" rule across projects — revisit.
