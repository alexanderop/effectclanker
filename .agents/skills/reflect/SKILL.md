---
name: reflect
description: >-
  Reflect on the conversation and update docs/. Use when wrapping up, after mistakes or corrections,
  or when significant codebase knowledge was gained. Complements the automatic Stop-hook reflection
  (`.claude/hooks/docs-reflection.sh`) — invoke this manually for a deeper pass. Triggers: "reflect",
  "remember this".
---

# Reflect

Review the conversation and persist learnings — to `docs/`, to skill files, or as structural enforcement.

This is the **manual** counterpart to `.claude/hooks/docs-reflection.sh`, which nudges automatically on stop. Use this skill mid-session, or when the auto-nudge fires and you want a deliberate pass.

## Process

1. **Read `docs/index.md`** and skim relevant subsection indexes (`docs/principles.md`, `docs/plans/index.md`) to understand what's already captured
2. **Scan the conversation** for:
   - Mistakes made and corrections received
   - User preferences and workflow patterns
   - Codebase knowledge gained (architecture, Effect-TS gotchas, patterns)
   - Tool/library quirks discovered (`@effect/ai`, Vitest, oxlint, etc.)
   - Decisions made and their rationale
   - Friction in skill execution, orchestration, or delegation
   - Repeated manual steps that could be automated or encoded
3. **Skip** anything trivial, conversational, or already captured
4. **Route each learning** to the right destination (see Routing below)
5. The `docs/principles.md` and `docs/plans/index.md` indexes regenerate automatically — don't hand-edit them. Update `docs/index.md` only if the new content deserves a top-level mention.

## Routing

Not everything belongs in `docs/`. Route each learning to where it will have the most impact.

### Structural enforcement check

Before routing a learning to `docs/`, ask: can this be a lint rule (oxlint), a script in `package.json`, a `bun run check` step, a type, or a runtime check in the code itself? If yes, encode it structurally and skip the doc note. See `docs/principles/encode-lessons-in-structure.md`.

### Doc files (`docs/`)

Codebase knowledge, principles, gotchas — anything that informs future sessions. The default destination. Use the `brain` skill for the writing conventions.

- One topic per file. File name = topic slug.
- Place principles under `docs/principles/`, gotchas under `docs/patterns/`, recipes under `docs/guides/`, plans under `docs/plans/`.
- `docs/index.md` is curated — only edit if the new content earns a top-level entry.

### Skill improvements (`.agents/skills/<skill>/`)

If a learning is about how a specific skill works — its process, prompts, or edge cases — update the skill directly.

### Backlog items (`docs/backlog.md`)

Follow-up work that can't be done during reflection — bugs, non-trivial rewrites, tooling gaps.

## Summary

```
## Reflect Summary
- Docs: [files created/updated, one-line each]
- Skills: [skill files modified, one-line each]
- Structural: [rules/scripts/checks added]
- Backlog: [follow-up items filed]
```
