# Chat UI: pi style reference

Our interactive chat (`src/chat-ui.tsx`) is deliberately modelled on pi's TUI.
When extending the UI, read pi's components first — that source is the ground
truth for the visual language we copy.

---

## Where pi's UI lives

All under `repos/pi/packages/coding-agent/src/modes/interactive/`:

| File                              | What to copy from it                                                         |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `components/user-message.ts`      | User-message "card" — background fill, padding.                              |
| `components/assistant-message.ts` | Plain markdown body, dim italic for thinking, error suffix on aborted turns. |
| `components/tool-execution.ts`    | Tool card with pending/success/error background colors.                      |
| `components/bash-execution.ts`    | Bash-specific `$ command` header + dim output + truncation status line.      |
| `components/footer.ts`            | Two-line dim footer: `pwd (branch)` on top, stats + model on bottom.         |
| `components/bordered-loader.ts`   | "thinking…" + cancel-key hint while streaming.                               |
| `components/keybinding-hints.ts`  | `dim key + muted description` formatting convention.                         |
| `theme/dark.json`                 | Hex colors. `userMsgBg = #343541` is the one we reuse verbatim.              |

pi uses its own `@earendil-works/pi-tui` framework; we use Ink. The visual
language ports across — colors, layout, glyph choices, padding — even though
the primitives don't.

## Pair tool-call / tool-result at render time, not in state

`ChatStateController.applyEvent` records `tool-call` and `tool-result` as two
separate transcript entries because the underlying `TurnEvent` stream emits
them separately. Pairing them earlier would couple state shape to a
presentation concern and complicate the stream → state mapping.

`chat-ui.tsx`'s `groupTranscript()` scans the transcript and folds adjacent
`tool-call` + `tool-result` entries with the same id into one `ToolGroup`
before rendering. That single grouped entry drives the bordered card (gray =
pending, green = success, red = error) — pi's `ToolExecutionComponent`
behaviour, expressed in React/Ink.

If you change `TurnEvent` shape or the `tool-*` entries in `chat-state.ts`,
update the grouping in `chat-ui.tsx` to match.

## setInterval is fine in UI code

`CLAUDE.md`'s "no `setTimeout`" rule is about **tests**. The `useSpinner` hook
in `chat-ui.tsx` uses `setInterval` to drive the braille spinner — same
pattern pi uses via `tui.requestRender()`. Don't try to remove it; an
animation loop without a timer is harder, not easier.

## Check ink-text-input before adding `useInput` shortcuts

The chat input is `ink-text-input`, which runs its own `useInput` and only
intercepts arrows, tab, return, backspace/delete, and `Ctrl+C`
(`node_modules/ink-text-input/build/index.js` — grep `key.ctrl`). Anything
else is free for our top-level `useInput` to claim, even while the user is
typing. When adding a new shortcut (e.g. `Ctrl+E` for "copy last error"),
verify against that source first rather than guessing — Ink doesn't surface
key conflicts, the second handler just silently no-ops on the swallowed
chord.
