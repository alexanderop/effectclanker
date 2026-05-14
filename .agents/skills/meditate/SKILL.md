---
name: meditate
description: >-
  Audit and evolve docs/ — prune outdated content, discover cross-cutting principles, review
  skills for structural encoding opportunities. Triggers: "meditate", "audit the docs".
---

# Meditate

**Quality bar:** A note earns its place by being **high-signal** (Claude would reliably get this wrong without it), **high-frequency** (comes up in most sessions or most tasks of a type), or **high-impact** (getting it wrong causes significant damage or wasted work). Everything else is noise. A lean, precise vault outperforms a comprehensive but bloated one.

## Process

### 1. Build snapshots

```bash
sh .agents/skills/meditate/scripts/snapshot.sh docs/ /tmp/docs-snapshot.md
sh .agents/skills/meditate/scripts/snapshot.sh .agents/skills/ /tmp/skills-snapshot.md
```

Files are delimited with `=== path/to/file.md ===` headers. The snapshot scripts already exclude `repos/` and `node_modules/`. Also locate the auto-memory directory (`~/.claude/projects/<project>/memory/`).

### 2. Auditor (blocking — its report feeds step 3)

Spawn `general-purpose` subagent. See `references/agents.md` for the full prompt spec. Inputs: docs snapshot, auto-memory path, CLAUDE.md path.

Audits doc notes, CLAUDE.md, and auto-memory for staleness, redundancy, low-value content, verbosity, and orphans. Returns a categorized report.

**Early-exit gate:** If the auditor finds fewer than 3 actionable items, skip step 3 and go directly to step 4.

### 3. Reviewer (after auditor completes)

Spawn one `general-purpose` subagent. See `references/agents.md` for the full prompt spec. Inputs: docs snapshot, skills snapshot, auditor report, `docs/principles.md`.

Combines three concerns in a single pass:

- **Synthesis**: Proposes missing wikilinks, flags principle tensions, suggests clarifications.
- **Distillation**: Identifies recurring patterns that reveal unstated principles. New principles must be (1) independent, (2) evidenced by 2+ notes, (3) actionable.
- **Skill review**: Cross-references skills against docs principles. Finds contradictions, missed structural enforcement, redundant instructions.

### 4. Review reports

Present the user with a consolidated summary. See `references/agents.md` for the report format.

### 5. Route skill-specific learnings

Check all reports for findings that belong in skill files, not `docs/`. Update the skill's SKILL.md or references/ directly. Read the skill first to avoid duplication.

### 6. Apply changes

Apply all changes directly. The user reviews the diff.

- **Outdated notes**: Update or delete
- **Redundant notes**: Merge into the stronger note, delete the weaker
- **Low-value notes**: Delete
- **Verbose notes**: Condense in place
- **New connections**: Add `[[wikilinks]]`
- **Tensions**: Reword to clarify boundaries
- **New principles**: Only from the distillation section, only if genuinely independent. Write under `docs/principles/`. The auto-index hook regenerates `docs/principles.md` on the next tool use.
- **Merge principles**: Look for principles that are subsets or specific applications of each other — merge the narrower into the broader
- **CLAUDE.md issues**: Rewrite or delete
- **Stale memories**: Delete or rewrite

### 7. Housekeep

Verify `docs/principles.md` and `docs/plans/index.md` regenerated correctly after any file additions or removals. `docs/index.md` is curated — only update by hand if a top-level entry changed.

## Summary

```
## Meditate Summary
- Pruned: [N notes deleted, M condensed, K merged]
- Extracted: [N new principles, with one-line + evidence count each]
- Skill review: [N findings, M applied]
- Housekeep: [state files cleaned]
```
