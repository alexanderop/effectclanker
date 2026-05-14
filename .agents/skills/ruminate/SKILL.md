---
name: ruminate
description: >-
  Mine past Claude Code conversations for uncaptured patterns, corrections, and knowledge.
  Cross-references with existing docs/. Triggers: "ruminate", "mine my history".
---

# Ruminate

Mine conversation history for knowledge that was never captured. Complements `reflect` (current session) and `meditate` (vault audit) by looking at the full archive of past conversations.

## Process

### 1. Read the vault

Build a docs snapshot: `sh .agents/skills/meditate/scripts/snapshot.sh docs/ /tmp/docs-snapshot-ruminate.md`. Pass the snapshot path to each analysis agent. This avoids loading the full vault into the ruminate orchestrator's context.

### 2. Locate conversations

Find the project conversation directory:

```
~/.claude/projects/-<cwd-with-dashes-replacing-slashes>/
```

### 3. Extract conversations

Run the extraction script to parse JSONL conversation files into readable text and split into batches:

```bash
python3 .agents/skills/ruminate/scripts/extract-conversations.py "$CONV_DIR" "$OUT_DIR" --batches N
```

Choose N based on the number of conversations found: ~1 batch per 20 conversations, minimum 2, maximum 10.

### 4. Spawn analysis team

Spawn N `general-purpose` subagents in parallel (one per batch). Each agent's prompt should include:

- The batch manifest path (`$OUT_DIR/batches/batch_N.txt`)
- The output path (`$OUT_DIR/findings_N.md`)
- The list of topics **already captured** in `docs/` (compiled from step 1) — so agents skip known knowledge
- Instructions to extract from each conversation:
  - **User corrections**: times the user corrected the assistant's approach, code, or understanding
  - **Recurring preferences**: things the user explicitly asked for or pushed back on repeatedly
  - **Technical learnings**: codebase-specific knowledge, Effect-TS gotchas, patterns discovered
  - **Workflow patterns**: how the user prefers to work
  - **Frustrations**: friction points, wasted effort, things that went wrong
  - **Skills wished for**: capabilities the user expressed wanting

Agents write structured findings to their output files.

### 5. Synthesize

After all agents complete, read all findings files. Cross-reference with existing docs/ content. Deduplicate across batches.

**Filter by frequency and impact.** Most findings won't be worth adding. Apply these filters before presenting:

- **Frequency**: Did this come up in multiple conversations, or was the user correcting the same mistake repeatedly? One-off corrections are usually not worth an entry — the vault should capture _patterns_, not incidents.
- **Factual accuracy**: Is something in `docs/` now wrong? These are always worth fixing regardless of frequency.
- **Impact**: Would failing to capture this cause repeated wasted effort in future sessions?

**Discard aggressively.** It's better to present 3 high-signal findings than 9 that include noise.

### 6. Present and apply

Present findings to the user in a table with columns: finding, frequency/evidence, and proposed action. Be honest about which findings are one-offs vs. recurring patterns — let the user decide what's worth adding.

**Route skill-specific learnings.** Check if any findings are about how a specific skill should work — its process, prompts, edge cases, or troubleshooting. Update the skill's SKILL.md directly. Read the skill first to avoid duplicating or contradicting existing content.

Apply only the changes the user approves. Follow vault writing conventions:

- One topic per file, organized in `docs/principles/`, `docs/patterns/`, `docs/guides/`, etc.
- Use `[[wikilinks]]` to connect related notes
- `docs/principles.md` and `docs/plans/index.md` auto-regenerate; only edit `docs/index.md` by hand if a top-level entry changes
- Default to updating existing notes over creating new ones

### 7. Clean up

Remove the temporary extraction directory:

```bash
rm -rf "$OUT_DIR"
```

## Guidelines

- **Filter aggressively.** Most conversations will have low signal — automated tasks, trivial exchanges, already-captured knowledge. Only surface what's genuinely new and impactful.
- **Prefer reduction.** If a finding is a special case of an existing principle, update the existing note rather than creating a new one.
- **Quote the user.** When a finding stems from a direct user correction, include the user's words — they carry the most signal about what matters.
