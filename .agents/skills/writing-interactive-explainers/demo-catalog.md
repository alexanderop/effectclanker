# Demo catalog

Nine demo kinds plus the `callout` aside pattern. You drop each demo into the HTML body as:

```html
<div class="demo-mount" data-kind="<kind>">
  <script type="application/json">
    { ...raw JSON, no escaping... }
  </script>
</div>
```

**The JSON inside the `<script type="application/json">` is raw.** Use any quotes, apostrophes, angle brackets you like — only the literal characters `</script>` are forbidden (and you'll never need them in a demo body). HTML body strings can contain `<code>`, `<em>`, `<span class='badge ok'>` directly.

## Pattern selection — read this before picking

The reader's eye gets bored when every demo is the same shape. **Rotate kinds across sections; don't pick the same one twice in a row.** A page that's five `step-through`s back-to-back reads like a single grey wall. Mix:

- a **flow** (movement, e.g. `flow-diagram` or `scrub-timeline`)
- a **structural diagram** (`stack`)
- an **editable / configurable** demo (`side-by-side` or `checklist-grid`)
- a **comparison** (`toggle-compare`)
- a **moment of stillness** (`spotlight` or `reveal`)
- and a `callout` aside or two for one-sentence emphasis

Pick by the _shape_ of the idea, not by what's easiest to fill in:

| If the idea is…                                            | Use                       |
| ---------------------------------------------------------- | ------------------------- |
| layered architecture / N nested concepts                   | `stack`                   |
| "edit this input, see this output"                         | `side-by-side`            |
| a checklist or sequence the reader clicks through          | `step-through`            |
| A vs B (default vs override, before vs after)              | `toggle-compare`          |
| a list of toggleable members that change two derived views | `checklist-grid`          |
| a sequence the reader should _feel_, not click through     | `scrub-timeline`          |
| dataflow / request path / pipeline                         | `flow-diagram`            |
| "what does each part of this exact snippet do?"            | `spotlight`               |
| "guess first, then I'll show you"                          | `reveal`                  |
| one sentence that deserves to slow the reader down         | `<aside class="callout">` |

## Contents

- [`stack`](#stack) — vertical N-row architecture diagram
- [`side-by-side`](#side-by-side) — editable inputs + two computed code panels
- [`step-through`](#step-through) — numbered timeline with play / back / next
- [`toggle-compare`](#toggle-compare) — A-vs-B switch, body changes per mode
- [`checklist-grid`](#checklist-grid) — toggle items, watch two code panels filter
- [`scrub-timeline`](#scrub-timeline) — drag a slider, frames accumulate; conversation aesthetic
- [`reveal`](#reveal) — a question with a button that exposes the answer (Shiki-highlighted)
- [`flow-diagram`](#flow-diagram) — vertical spine of nodes, lights up one at a time on play
- [`spotlight`](#spotlight) — code on one side, clickable line-pinned annotations on the other
- [`callout` aside](#callout) — tinted blockquote-style sidebar for one-sentence emphasis

---

## stack

Labeled rows with ▼ arrows between them. Best for "the N-layer model" overviews.

```html
<div class="demo-mount" data-kind="stack">
  <script type="application/json">
    {
      "rows": [
        { "tag": "Tool", "desc": "a typed spec for one capability", "tint": "hot" },
        { "tag": "Toolkit", "desc": "a record of tools + their handlers", "tint": "kit" },
        { "tag": "LanguageModel", "desc": "drives one model call", "tint": "model" }
      ],
      "arrows": ["composed by", "consumed by"]
    }
  </script>
</div>
```

- `tint`: one of `hot` (amber), `kit` (purple), `model` (green). Picks the left-border accent.
- `arrows`: optional. If provided, must have `rows.length - 1` entries.

---

## side-by-side

Inputs on the left drive two derived code panels. Both panels are Shiki-highlighted.

```html
<div class="demo-mount" data-kind="side-by-side">
  <script type="application/json">
    {
      "inputs": [
        { "name": "toolName", "type": "text", "default": "read", "label": "name" },
        { "name": "param", "type": "text", "default": "path", "label": "first param" },
        {
          "name": "kind",
          "type": "select",
          "options": ["String", "Number", "Boolean"],
          "default": "String",
          "label": "type"
        }
      ],
      "leftLang": "ts",
      "leftLabel": "Your Tool.make spec",
      "leftTemplate": "Tool.make(\"{toolName}\", {\n  parameters: { {param}: Schema.{kind} },\n})",
      "rightLang": "json",
      "rightLabel": "What the model sees",
      "rightTemplate": "{\n  \"name\": \"{toolName}\",\n  \"input_schema\": {\n    \"properties\": { \"{param}\": { \"type\": \"{kind:lower}\" } }\n  }\n}"
    }
  </script>
</div>
```

- `inputs[].type`: `"text"` or `"select"` (with `options: string[]`).
- Templates interpolate `{name}` with the input's current value.
- `{name:lower}` lowercases the value. `{name:upper}` uppercases. That's the only transform.
- Inner `"` inside JSON strings → `\"`. Newlines → `\n`. Standard JSON escapes.
- For binary toggles, use `toggle-compare`. This demo is for continuous editing.

---

## step-through

Numbered timeline. Each row reveals (springs in) as you advance the step. Play / back / next / reset buttons + a step counter.

```html
<div class="demo-mount" data-kind="step-through">
  <script type="application/json">
    {
      "label": "timeline of one tool call",
      "steps": [
        { "num": "1.", "body": "model emits <code>tool_use</code> → read(\"/no/such/file\")" },
        { "num": "2.", "body": "handler runs, fails with <code>FileNotFound</code>" },
        { "num": "3.", "body": "framework catches the failure" },
        { "num": "4.", "body": "encodes the failure into the response" },
        {
          "num": "5.",
          "body": "<span class='badge ok'>turn survives</span> — model can recover next turn"
        }
      ]
    }
  </script>
</div>
```

- `body` is HTML rendered with `dangerouslySetInnerHTML`. Write tags directly — `<code>`, `<em>`, `<strong>`.
- Recognised badge classes: `badge ok`, `badge fail`, `badge mute`.
- Note the single quotes for `class='badge ok'` — the JSON string is double-quoted, so inner attribute quotes use `'` to avoid `\"` churn.
- Aim for 5–7 steps. Past 8 it gets tedious.

---

## toggle-compare

Like `step-through`, but with two variants chosen by a sliding-pill toggle.

```html
<div class="demo-mount" data-kind="toggle-compare">
  <script type="application/json">
    {
      "label": "timeline of one tool call that fails",
      "options": [
        { "value": "return", "label": "failureMode: \"return\"" },
        { "value": "error", "label": "failureMode: \"error\" (default)" }
      ],
      "variants": {
        "return": [
          { "num": "1.", "body": "model emits a failing tool_use" },
          { "num": "2.", "body": "framework catches and encodes the failure" },
          { "num": "3.", "body": "<span class='badge ok'>turn survives</span>" }
        ],
        "error": [
          { "num": "1.", "body": "model emits a failing tool_use" },
          { "num": "2.", "body": "failure escapes <code>generateText</code>" },
          { "num": "3.", "body": "<span class='badge fail'>turn dies</span>" }
        ]
      }
    }
  </script>
</div>
```

- Exactly two `options`. The toggle is a binary contrast, not a multi-way picker.
- Both variants should have the same number of steps. Pad with a filler step if you must.

---

## checklist-grid

Toggle items in the control row; two Shiki-highlighted code panels show only the enabled items. Best for "list of things + their counterparts".

```html
<div class="demo-mount" data-kind="checklist-grid">
  <script type="application/json">
    {
      "items": [
        { "name": "read", "handler": "readHandler", "default": true },
        { "name": "write", "handler": "writeHandler", "default": true },
        { "name": "edit", "handler": "editHandler", "default": true },
        { "name": "bash", "handler": "bashHandler", "default": false },
        { "name": "glob", "handler": "globHandler", "default": true },
        { "name": "grep", "handler": "grepHandler", "default": false }
      ],
      "leftLang": "ts",
      "leftLabel": "src/toolkit.ts",
      "leftItem": "  {Name}Tool,",
      "leftWrap": "export const HarnessToolkit = Toolkit.make(\n{ITEMS}\n);",
      "rightLang": "ts",
      "rightLabel": ".toLayer — the handler record",
      "rightItem": "    {name}: {handler},",
      "rightWrap": "export const HarnessToolkitLayer =\n  HarnessToolkit.toLayer({\n{ITEMS}\n  });"
    }
  </script>
</div>
```

- Each `items[]` entry's fields are available to the templates as `{fieldName}`.
- `{Name}` (capitalised) is auto-derived from `name`.
- `leftItem` / `rightItem` render once per _enabled_ item; results are newline-joined and substituted into `{ITEMS}` in the wrap.

---

## scrub-timeline

A horizontal slider drives a frame index; frames appear in sequence as you drag. Frames are styled by `actor` (color-coded left border, uppercase label). This is the **Comeau "scrub through time"** pattern — use it when you want the reader to _feel_ the sequence rather than click through it. Perfect for showing a conversation or message thread accumulating.

```html
<div class="demo-mount" data-kind="scrub-timeline">
  <script type="application/json">
    {
      "label": "drag to play out one agent loop",
      "frames": [
        { "actor": "user", "body": "what's in /etc/hosts?" },
        { "actor": "assistant", "body": "<code>tool_use: read({ path: \"/etc/hosts\" })</code>" },
        { "actor": "tool", "body": "127.0.0.1 localhost" },
        { "actor": "assistant", "body": "localhost maps to 127.0.0.1." }
      ]
    }
  </script>
</div>
```

- `actor`: one of `user` (purple), `assistant` (amber), `tool` (green), `system` (mute). Picks the left-border accent and the small uppercase label.
- `body` is rendered with `dangerouslySetInnerHTML` — write `<code>`, `<em>`, `<strong>` inline.
- Provides a slider (range), a `▶ Play` button (auto-advances 1 frame every 650ms), and a `↺ reset`.
- Aim for 3–6 frames. Past 6 the slider feels chunky.

Distinct from `step-through`: that one uses buttons and a "checklist" feel; this one uses a slider and a "conversation" feel. **Don't use both on the same page unless the contrast is the point.**

---

## reveal

A question, a button, an answer. The button hides the answer until clicked. Once clicked, the answer (Shiki-highlighted) springs in. Forces the reader to _predict before peeking_ — pedagogy more than UI.

```html
<div class="demo-mount" data-kind="reveal">
  <script type="application/json">
    {
      "question": "What JSON does the model emit when it wants to read <code>/etc/hosts</code>?",
      "buttonLabel": "Reveal the JSON",
      "lang": "json",
      "answer": "{\n  \"type\": \"tool_use\",\n  \"name\": \"read\",\n  \"input\": { \"path\": \"/etc/hosts\" }\n}",
      "afterText": "That's it. The model never reads the file — it just asks."
    }
  </script>
</div>
```

- `question` is HTML — use `<code>`, `<em>`.
- `buttonLabel` defaults to `"Reveal"` if omitted.
- `lang` is any Shiki language id (`ts`, `json`, `bash`, `tsx`, …).
- `afterText` is optional HTML, rendered below the code after reveal.
- Best used **once or twice** per page. It loses its punch if every section ends with a button.

---

## flow-diagram

Vertical chain of labeled nodes with `▼` arrows between them. Hit play (or `step ›`) and nodes light up one at a time, accumulating a purple-glow trail. Different shape from `stack`: `stack` is static structure, `flow-diagram` is a sequence in time.

```html
<div class="demo-mount" data-kind="flow-diagram">
  <script type="application/json">
    {
      "label": "one round-trip",
      "nodes": [
        { "label": "user prompt" },
        { "label": "<code>LanguageModel.generateText</code>" },
        { "label": "Anthropic API (one HTTP call)" },
        { "label": "<code>Toolkit.handle</code> dispatches" },
        { "label": "<code>readHandler</code> reads the file" },
        { "label": "<code>tool_result</code> encoded into the response" }
      ],
      "arrowChar": "▼"
    }
  </script>
</div>
```

- `label` is HTML — `<code>`, `<em>`, `<strong>` all work.
- `arrowChar` defaults to `▼`; pass `"↓"`, `"⇣"`, or `"⟶"` if you want a different glyph.
- Aim for 4–8 nodes. Past 8, the spine starts feeling like a step-through.

Use this for **request paths, pipelines, sequences with causality** — anywhere the next thing happens _because of_ the previous thing. For "the 3 layers of our architecture," use `stack` instead.

---

## spotlight

A code snippet on one side, clickable annotation cards on the other. Click a card to anchor the reader's eye to a specific line of the code (purple left-border highlight). Best for "what does each part of _this exact line_ do."

```html
<div class="demo-mount" data-kind="spotlight">
  <script type="application/json">
    {
      "label": "anatomy of Tool.make",
      "lang": "ts",
      "code": "Tool.make(\"read\", {\n  description: \"Read a file.\",\n  parameters: { path: Schema.String },\n  success: Schema.String,\n  failure: FileError,\n  failureMode: \"return\",\n})",
      "notes": [
        { "line": 1, "label": "the name", "body": "What the model sees when picking a tool." },
        { "line": 3, "label": "parameters", "body": "Effect Schema → JSON Schema, automatically." },
        { "line": 5, "label": "failure", "body": "Typed failure schema. Keeps failures as data." },
        {
          "line": 6,
          "label": "failureMode",
          "body": "<strong>Always</strong> <code>\"return\"</code>."
        }
      ]
    }
  </script>
</div>
```

- `line` is 1-based — line 1 is the first line of `code`.
- `label` is a short uppercase-ish header on each note card.
- `body` is HTML (`<code>`, `<strong>`, `<em>`).
- The first note is selected by default.
- Aim for 3–6 notes. More than 6 and the right column gets taller than the code.

Keep the snippet short — under 10 lines. Past 12 lines the line-highlight is harder to see because the code panel doesn't scroll on note click.

---

## callout (HTML aside — not a demo)

For one-sentence emphasis that doesn't deserve a full demo. Plain HTML, no JSON, no `demo-mount`. Three tints: default (purple), `warn` (amber), `ok` (green), `bad` (red).

```html
<aside class="callout">
  <strong>Mental model</strong>
  <p>The model never touches your filesystem. It asks; your handler runs.</p>
</aside>

<aside class="callout warn">
  <strong>Gotcha</strong>
  <p><code>failureMode</code> defaults to <code>"error"</code>. That default is <em>wrong</em>.</p>
</aside>

<aside class="callout ok">
  <strong>Rule of thumb</strong>
  <p>If your section is a <em>flow</em>, use <code>flow-diagram</code>.</p>
</aside>

<aside class="callout bad">
  <strong>Don't</strong>
  <p>Don't put a credential-reading Layer in <code>MainLive</code>.</p>
</aside>
```

- The first `<strong>` becomes the small uppercase tinted title.
- Subsequent `<p>` tags are body prose.
- Use sparingly — two or three per page. They lose impact if there's one in every section.
