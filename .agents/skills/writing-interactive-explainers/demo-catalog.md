# Demo catalog

Five demo kinds. You drop each one into the HTML body as:

```html
<div class="demo-mount" data-kind="<kind>">
  <script type="application/json">
    { ...raw JSON, no escaping... }
  </script>
</div>
```

**The JSON inside the `<script type="application/json">` is raw.** Use any quotes, apostrophes, angle brackets you like — only the literal characters `</script>` are forbidden (and you'll never need them in a demo body). HTML body strings can contain `<code>`, `<em>`, `<span class='badge ok'>` directly.

## Contents

- [`stack`](#stack) — vertical N-row architecture diagram
- [`side-by-side`](#side-by-side) — editable inputs + two computed code panels
- [`step-through`](#step-through) — numbered timeline with play / back / next
- [`toggle-compare`](#toggle-compare) — A-vs-B switch, body changes per mode
- [`checklist-grid`](#checklist-grid) — toggle items, watch two code panels filter

---

## stack

Labeled rows with ▼ arrows between them. Best for "the N-layer model" overviews.

```html
<div class="demo-mount" data-kind="stack">
  <script type="application/json">
    {
      "rows": [
        { "tag": "Tool",          "desc": "a typed spec for one capability",    "tint": "hot"   },
        { "tag": "Toolkit",       "desc": "a record of tools + their handlers", "tint": "kit"   },
        { "tag": "LanguageModel", "desc": "drives one model call",              "tint": "model" }
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
        { "name": "toolName", "type": "text",   "default": "read",  "label": "name" },
        { "name": "param",    "type": "text",   "default": "path",  "label": "first param" },
        { "name": "kind",     "type": "select", "options": ["String","Number","Boolean"], "default": "String", "label": "type" }
      ],
      "leftLang":      "ts",
      "leftLabel":     "Your Tool.make spec",
      "leftTemplate":  "Tool.make(\"{toolName}\", {\n  parameters: { {param}: Schema.{kind} },\n})",
      "rightLang":     "json",
      "rightLabel":    "What the model sees",
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
        { "num": "5.", "body": "<span class='badge ok'>turn survives</span> — model can recover next turn" }
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
        { "value": "error",  "label": "failureMode: \"error\" (default)" }
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
        { "name": "read",  "handler": "readHandler",  "default": true  },
        { "name": "write", "handler": "writeHandler", "default": true  },
        { "name": "edit",  "handler": "editHandler",  "default": true  },
        { "name": "bash",  "handler": "bashHandler",  "default": false },
        { "name": "glob",  "handler": "globHandler",  "default": true  },
        { "name": "grep",  "handler": "grepHandler",  "default": false }
      ],
      "leftLang":   "ts",
      "leftLabel":  "src/toolkit.ts",
      "leftItem":   "  {Name}Tool,",
      "leftWrap":   "export const HarnessToolkit = Toolkit.make(\n{ITEMS}\n);",
      "rightLang":  "ts",
      "rightLabel": ".toLayer — the handler record",
      "rightItem":  "    {name}: {handler},",
      "rightWrap":  "export const HarnessToolkitLayer =\n  HarnessToolkit.toLayer({\n{ITEMS}\n  });"
    }
  </script>
</div>
```

- Each `items[]` entry's fields are available to the templates as `{fieldName}`.
- `{Name}` (capitalised) is auto-derived from `name`.
- `leftItem` / `rightItem` render once per *enabled* item; results are newline-joined and substituted into `{ITEMS}` in the wrap.
