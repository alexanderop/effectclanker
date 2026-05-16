# Ink + ink-text-input gotchas

Non-obvious behaviors of the libraries the TUI is built on. Read before
layering new keyboard handling over the chat input in
`packages/tui/src/chat-ui.tsx`.

## `ink-text-input` ignores Up / Down / Tab / Shift+Tab

`node_modules/ink-text-input/build/index.js:46-48`:

```js
if (
  key.upArrow ||
  key.downArrow ||
  (key.ctrl && input === "c") ||
  key.tab ||
  (key.shift && key.tab)
) {
  return;
}
```

The component's internal `useInput` short-circuits on these keys, so our
own `useInput` in `ChatApp` (`chat-ui.tsx:328`) can claim them for picker
navigation, focus changes, or any other affordance without fighting the
input. No need to fork, swap libraries, or toggle the `focus` prop.

The relevant keys our `useInput` is free to consume:

- `key.upArrow`, `key.downArrow` — picker selection, history scroll, etc.
- `key.tab`, `key.shift && key.tab` — completion / focus cycling
- `key.ctrl && input === 'c'` — already used for cancel-streaming / clear-draft / exit

## Enter is the one key both handlers want

`key.return` is _not_ in the ignore list above. `ink-text-input` calls
`onSubmit(value)` on Enter. To branch Enter behaviour (e.g. "submit
prompt" vs "select picker entry"), route the decision through
`onSubmit` itself, not through a parallel `useInput`:

```ts
<TextInput
  onSubmit={(value) => {
    if (pickerVisible) {
      selectPickerEntry();
      return;
    }
    submitPrompt(value);
  }}
/>
```

Ink does not guarantee the relative order of `useInput` callbacks and
the component's internal handler, so handling Enter in two places risks
double-firing.

## Letters and Backspace always reach the input

Anything not in the ignore list is consumed by `ink-text-input` to mutate
the buffer. That means typing letters while a popup is open will always
edit the draft — design popups whose state is _derived_ from the draft
(filter result, etc.) so they update naturally, rather than trying to
"capture" the keystrokes upstream.

## Programmatic `value` changes don't move the cursor to the end

`node_modules/ink-text-input/build/index.js:11-25` only caps the cursor
when the _previous_ cursor offset would land past the new value's end —
it never advances the cursor. So if the user has typed `/c` (cursor at
offset 2) and we replace `draft` with `/clear` (length 6) via
`setDraft`, the cursor stays at offset 2. The user's next keystroke
edits _between_ the slash and the `c`.

The remount-via-`key` trick fixes this. The `useState` initializer at
`ink-text-input/build/index.js:6` sets `cursorOffset = (originalValue || '').length`,
so a remount = "cursor at end of value":

```tsx
const [editVersion, setEditVersion] = useState(0);
// ...
<TextInput key={editVersion} value={draft} onChange={setDraft} ... />

// On any programmatic buffer rewrite (e.g. picker selects a skill):
setDraft("/skill-name ");
setEditVersion((v) => v + 1);
```

Only do this on _programmatic_ edits. Every keystroke remount would
thrash. The picker's skill-select path is the only known user today.
