---
name: writing-interactive-explainers
description: Produces a single-file interactive HTML explainer (dark theme, embedded React demos via CDN) by editing a self-contained template in place, written in Josh Comeau's conversational voice. Use when the user asks for an "interactive guide", "blog post explainer", "Josh Comeau style writeup", "visual deep-dive", "make this visual", or wants to turn a technical topic into a learning page with playable demos.
---

# Writing interactive explainers

Take a topic the user wants to teach. Produce one HTML file: a dark-themed page with embedded React demos, written in Josh Comeau's conversational voice.

**There is no build step.** You copy `template.html`, edit the HTML in place, and open the file in a browser. The template already contains one working example of every demo kind — keep, modify, or delete them as you write.

## Workflow

Copy this checklist into your reply and tick items off:

```
- [ ] 1. Research the topic — read code, docs, repos/, whatever's needed
- [ ] 2. cp template.html <topic>.html
- [ ] 3. Edit <topic>.html: title, subtitle, TOC, sections, demos
- [ ] 4. Open in headless Chrome, screenshot, re-read before declaring done
```

### Step 1 — Research

Read source code, repo docs, or whatever the topic requires. Take notes; don't draft yet.

### Step 2 — Copy the template

```bash
cp ~/.claude/skills/writing-interactive-explainers/template.html <topic>.html
```

### Step 3 — Edit

Search the file for `<!-- EDIT: ... -->` markers. They mark every place you should touch:

1. `<!-- EDIT: title -->` — the `<h1>` and `<title>` tag (two places, same text)
2. `<!-- EDIT: subtitle -->` — one-sentence hook under the title
3. `<!-- EDIT: toc -->` — the TOC `<a>` links; match your section ids
4. `<!-- EDIT: body -->` — the main prose + demos

For the body, write 4–7 sections. Each section is:

```html
<h2 id="section-slug">Section Title</h2>
<p>Prose. Read voice.md first — the voice is non-negotiable.</p>

<div class="demo-mount" data-kind="<kind>">
  <script type="application/json">
    { ...props as raw JSON... }
  </script>
</div>

<p>Why-it-matters paragraph after the demo.</p>
```

See `demo-catalog.md` for the nine `data-kind` values plus the `<aside class="callout">` pattern, with full props shapes. The template already contains one working example of each — use them as live reference.

If a section doesn't need a demo, leave it out — most explainers mix sections with and without demos. **And don't pick the same demo kind twice in a row.** A page full of `step-through`s looks like a single grey wall; mix `flow-diagram`, `scrub-timeline`, `spotlight`, `reveal`, and `callout` asides between them. `demo-catalog.md` has a selection table — read its top before choosing.

**Do not edit anywhere outside the EDIT markers.** The React bootstrap, the demo components, the CSS — all of that is the runtime. Touch it and demos stop rendering.

### Step 4 — Verify

```bash
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --headless=new \
  --window-size=1400,4000 --virtual-time-budget=6000 \
  --screenshot=/tmp/verify.png "file://$PWD/<topic>.html"
```

Read the screenshot. If any panel overflows, any demo is empty, or the prose reads flat, return to Step 3.

## File map

- `voice.md` — the Josh Comeau voice checklist; read before drafting
- `demo-catalog.md` — the nine demo kinds + the `callout` aside pattern, with the selection table
- `template.html` — the page you copy and edit

## Common failures

- **Generic prose.** Re-read `voice.md`. Every section opens with a hook — a confession, a question, "let's slow down" — never a topic sentence.
- **Flat page, every demo looks the same.** You used `step-through` or `stack` five times in a row. Open `demo-catalog.md`, read the *Pattern selection* table at the top, then rotate. Aim for at least 4 distinct demo kinds across a 5-section page, plus 1–2 `callout` asides.
- **Demo doesn't render.** The card shows why. Almost always invalid JSON inside the `<script type="application/json">` (unescaped quote, trailing comma, missing comma between fields) or an unknown `data-kind`.
- **Missing script.** A `<div class="demo-mount">` with no `<script type="application/json">` child mounts an error. Each demo needs the script.
- **Overflowing panel.** A line in your JSON is too long for the grid column. Split the string with `\n`.
- **Wrong `<h2>` ids.** TOC links break silently. Make `id="..."` match `href="#..."`.
- **`spotlight` line highlight off-by-one.** `line` is 1-based, not 0-based. Line 1 is the first line of `code`.
