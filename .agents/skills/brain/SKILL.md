---
name: brain
description: >-
  Read/write the docs/ vault — this project's persistent memory. Use for any task that persists
  knowledge: reflection, planning, gotchas, principles, or direct edits. Triggers: docs/ modifications,
  "add to docs", "remember this".
---

# Brain (docs/)

In this repo the persistent-memory vault is `docs/`. It doubles as the project wiki *and* the agent's long-term memory.

The brain is the foundation of the entire workflow — every agent, skill, and session reads it. Low-quality or speculative content degrades everything downstream. Before adding anything, ask: "Does this genuinely improve how the system operates?" If the answer isn't a clear yes, don't write it.

## Before Writing

Read `docs/index.md` first. Then read the relevant entrypoint for your topic:

- `docs/principles.md` for principles
- `docs/plans/index.md` for active or past plans
- `docs/patterns/effect-ai-gotchas.md` for `@effect/ai`-specific gotchas
- `docs/guides/` for how-to recipes

For directories without a dedicated index file, scan nearby files directly and edit an existing note when possible.

## Structure

```
docs/
├── index.md                <- curated wiki landing page (manually maintained, NEVER auto-rewritten)
├── architecture.md         <- the three layers, dataflow
├── tooling.md              <- stack, check pipeline
├── testing-strategy.md     <- pyramid
├── backlog.md              <- known follow-ups
├── principles.md           <- index for principles/ (auto-rebuilt)
├── principles/             <- engineering and design principles (one per file)
├── plans/                  <- phased implementation plans
│   └── index.md            <- auto-rebuilt
├── guides/                 <- how-to recipes (adding-a-tool, testing)
├── patterns/               <- gotchas, conventions (effect-ai-gotchas)
└── stories/                <- learning narratives / journals
```

**Rules:**

- One topic per file. `docs/patterns/anthropic-rate-limits.md`, not a mega-file.
- `docs/index.md` is the curated root — every section should be reachable from it. **Do not rewrite it programmatically.**
- `docs/principles.md` and `docs/plans/index.md` are auto-rebuilt by the PostToolUse hook. Don't hand-edit them — just add or remove files in the directory and the hook regenerates the index.
- File names: lowercase, hyphenated. `effect-ai-gotchas.md`.

## Wikilinks

Format: `[[section/file-name]]`. Resolution order: same directory, then relative path, then vault root. Heading anchors (`[[file#heading]]`) are stripped during resolution.

## Writing Style

- Bullets over prose. No preamble.
- Plain markdown with `# Title`. No frontmatter on memory notes.
- Keep notes under ~50 lines. Split if longer.

## After Writing

If you added or removed a file in `docs/principles/` or `docs/plans/`, the auto-index hook will rebuild the matching index. For other directories, update `docs/index.md` by hand if the new entry deserves a top-level mention.

## Durability Test

Ask: "Would I include this in a prompt for a *different* task?"

- **Yes** → write to `docs/`. It's durable knowledge.
- **No, it's plan-specific** → update the plan's docs instead.
- **No, it's a skill issue** → update the skill file directly.
- **No, it needs follow-up work** → add it to `docs/backlog.md`.

## Maintenance

- Delete outdated or subsumed notes.
- Merge overlapping notes before adding new ones.
- When `repos/` content makes a doc redundant, link to the source file and delete the doc.
