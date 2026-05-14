---
name: design-spec
description: >-
  Turn a rough feature request into a concrete spec file at `specs/pending/<slug>.md`.
  Read the codebase first, then ask the user targeted questions, then write the spec.
  Use when the user says "design a spec", "spec this out", "/design-spec", or hands you a
  feature idea that needs to become a concrete spec before implementation starts.
argument-hint: short feature description (e.g. "dark mode", "add a search tool")
allowed-tools: Read, Glob, Grep, AskUserQuestion, Write, Edit, Bash
---

# design-spec

Co-author a spec with the user. The user describes what they want; you read the relevant
code first so questions land on real choices, not generic ones; you ask iteratively until
the spec is concrete; then you write it to `specs/pending/<slug>.md`.

The output must follow the spec format below exactly — `Goal`, `Requirements`,
`Implementation hints`, `Acceptance criteria`. Do not invent new sections.

## The job

1. Take the user's rough description (`$ARGUMENTS`) and treat it as the seed, not the spec.
2. Read the codebase well enough that your questions point at real files, real patterns,
   real choices the user has to make.
3. Ask focused questions via `AskUserQuestion` — small batches, options grounded in what
   you found.
4. Loop on read + ask until the spec has no hand-wavy parts left.
5. Write `specs/pending/<slug>.md` in the format below.
6. Show the user the final spec path and a one-line summary.

You are NOT implementing the feature. You are producing the spec file. Stop at the spec.

## Step 1 — Anchor in the codebase

Before asking anything, spend a few tool calls building a real mental model:

- Read `CLAUDE.md` and `docs/overview.md` for project shape and conventions.
- Read `docs/testing-strategy.md` and `docs/guides/testing.md` — the spec has to encode a
  TDD plan, and you can't do that without knowing the two-tier setup (handler-direct vs
  toolkit-via-mock), the `it.effect` / `withTmpDir` / `expectLeft` helpers, and the no-real-LLM-in-CI rule.
- `Glob` / `Grep` for files the feature most plausibly touches. If the user said "add a
  search tool", look at `src/tools/*.ts` AND `test/tools/*.test.ts` side by side — that's
  where new tools and their tests live in this repo.
- Read 1–3 sibling files end-to-end (source + its test) so you know the actual patterns
  (the `Tool.make` spec + handler shape, the `it.effect` test shape), not a vague
  description of them.
- Check `docs/guides/` for an existing recipe (`docs/guides/adding-a-tool.md` exists for
  the most common case — read it before specifying a new tool).
- Check `docs/patterns/` for gotchas relevant to the change.
- Note existing tests, types, services that the new feature will reuse or extend.

If you can't name the specific files the feature will touch and the patterns it should
follow, you haven't read enough yet. Keep reading.

For broader exploration (≥3 search queries, unclear scope) delegate to the Explore agent
instead of burning the main context window — see `docs/principles/guard-the-context-window.md`.

## Step 2 — Ask grounded questions

Use `AskUserQuestion` with 2–4 questions per round. Each option should reference something
real from Step 1 — a file, an existing pattern, a concrete tradeoff — not a generic choice.

**Bad (generic):**
> What scope do you want? — MVP / Full-featured / Backend only

**Good (grounded):**
> Should the new `search` tool follow `src/tools/grep.ts` (single ripgrep call, streaming
> result) or `src/tools/glob.ts` (filesystem walk, returns a list)?

Question rounds to cover, in roughly this order — skip any that the user's initial
description or earlier answers already settled:

1. **Boundary & shape.** What layer does this live in? Tool / service / CLI flag / new
   doc? Which existing file is the closest sibling?
2. **Behavior.** Inputs, outputs, error cases. What happens when X is missing? When the
   underlying call fails?
3. **Wiring.** How does this reach the user — toolkit registration, CLI flag, exported
   from `src/index.ts`? Any layer/scope concerns (see `docs/patterns/effect-ai-gotchas.md`)?
4. **TDD plan.** This is the most important round — the spec is consumed by a TDD
   workflow (`/tdd` red→green→refactor). Walk the user through it:
   - **First failing test.** What is the *single smallest* test that proves the feature
     exists? Name the file (`test/tools/<name>.test.ts`), the `it.effect` description,
     and the assertion. This becomes the red step.
   - **Tier.** Handler-direct only (most cases), toolkit-via-mock (if dispatch changes),
     or both. Default to handler-direct unless the feature is about how the model picks
     or wires a tool.
   - **Fixtures and helpers.** Which of `withTmpDir`, `withTmpFile`, `expectLeft`,
     `mockToolCall`, `mockText`, `runToolkit` apply? Anything new needed in
     `test/utilities.ts`?
   - **Error cases as separate tests.** Each error case in round 2 gets its own
     `it.effect` — list them. `expectLeft(result, "ExpectedTag")` for tagged failures,
     not try/catch.
   - **Flake hazards.** Anything timing-sensitive, network-bound, or filesystem-shared?
     Per `CLAUDE.md`: no `setTimeout`, await the condition, no real LLM calls.
5. **Out of scope.** What we are explicitly NOT building so the implementer doesn't drift.

Stop asking when the next thing you'd ask has a single defensible answer from the answers
already given. Don't pad the interview.

## Step 3 — Confirm before writing

Once you've got enough, summarize back in 5–8 bullets: feature name, where it lives, the
key shape decisions, the acceptance bar. Ask one final yes/no via `AskUserQuestion`:
"Write the spec now?" with options "Yes, write it" / "Tweak first".

If they want a tweak, loop back to Step 2 on the specific item.

## Step 4 — Write `specs/pending/<slug>.md`

- Slug: kebab-case, derived from the feature name. Keep it short (`dark-mode`,
  `search-tool`, not `add-a-new-search-tool-for-the-harness`).
- If `specs/pending/` doesn't exist yet, create it.
- If `specs/pending/<slug>.md` already exists, ask the user before overwriting.
- Use absolute paths in any file references inside the spec.

### Exact spec format

```markdown
# <Feature Name>

## Goal
<One sentence. What gets added or changed, from the user's point of view.>

## Requirements
- <Concrete, testable requirement.>
- <Another. Phrase as observable behavior, not implementation.>
- <Cover the happy path and the main error/edge cases the user named.>

## Implementation hints
- <Sibling source file to mirror, by absolute path.>
- <Sibling test file to mirror, by absolute path — TDD starts here.>
- <Helpers from `test/utilities.ts` to reuse: `withTmpDir`, `expectLeft`, `mockToolCall`, …>
- <Toolkit/layer/wiring step not to forget.>
- <Any gotcha from `docs/patterns/` that applies.>
- <Don't over-specify HOW — the implementer picks details if conventions cover them.>

## Acceptance criteria
TDD order — write the first test, watch it fail, then make it pass. Then the next.

- [ ] **Red:** `test/...:<it.effect description>` exists and fails for the expected reason
      (feature not implemented yet, not a typo).
- [ ] **Green:** the same test passes after the minimum implementation.
- [ ] <Next behavior test — one per requirement from round 2.>
- [ ] <Error-case test — `expectLeft(result, "<Tag>")` for each error case.>
- [ ] <Toolkit-via-mock test in `test/toolkit.test.ts` — only if dispatch changes.>
- [ ] `bun run check` passes (typecheck, lint, format, tests)
- [ ] No `setTimeout`, no real LLM calls, no flaky waits — per `CLAUDE.md`.
```

### Quality bar for the spec

- **Goal** is one sentence, written from outside the codebase.
- **Requirements** are observable behaviors. No "should be clean", "well-tested", "robust".
- **Implementation hints** reference real files in this repo. If you cite `repos/effect/`
  or `repos/codex/` as a reference, link the path — remember those are read-only.
- **Acceptance criteria** are TDD-ordered. The first checkbox must be the *red* test —
  named file, named `it.effect` description, expected failure reason. The implementer
  should be able to write that test before reading the rest of the spec.
- Every requirement has at least one test checkbox. Every error case has its own test
  checkbox using `expectLeft(result, "<Tag>")`. The `bun run check` line is mandatory
  per `CLAUDE.md`.
- One feature per spec. If the answers reveal two features, write two specs.
- No CLAUDE.md duplication. Hint at the convention, don't restate it.

## Step 5 — Hand off

Print:

```
Spec written: specs/pending/<slug>.md
```

Do not start implementing. Do not run `bun run check`. That's the next step, not this one.

## Anti-patterns

- **Asking before reading.** Generic clarifying questions waste the user's time. Always
  read first.
- **Writing the spec then asking.** The interview is the work. The write is the output.
- **Inventing sections.** No "Success Metrics", "Open Questions", "Background". Stick to
  the four sections above.
- **Over-specifying.** If `CLAUDE.md` already says "match neighboring patterns", don't
  re-list the patterns in the spec.
- **Vague acceptance.** "Tests pass" is not an acceptance criterion — `bun run check` is.
  "Feature works" is not — "GET /api/X returns {…}" is.
- **Skipping the TDD plan.** If you can't name the first failing test by file and
  description, the spec isn't done. Go back to round 4.
- **One mega-test.** Each requirement and each error case is its own `it.effect`. A
  single "covers everything" test is a smell — split it in the spec, not later.
