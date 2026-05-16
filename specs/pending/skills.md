# Skills + slash-command picker

## Goal

Discover Claude-Code / AGENTS-style `SKILL.md` files from the user's home
directory and the current project, expose each one through two surfaces,
and let the user discover both surfaces (plus the harness's own builtin
commands) interactively from the TUI:

1. **Auto-trigger (model-callable).** A new `skill` tool — enumerated over
   the discovered names — that the model invokes mid-turn to inject a
   skill's full body and adjacent-file list into the conversation.
2. **Manual trigger (user-typed).** **Slash commands** `/<name> [args]`
   in the TUI: either a **Skill trigger** (renders the skill body with
   `$ARGUMENTS` substitution or append-fallback, forwards as the user's
   prompt) or a **Builtin command** (`/help`, `/clear`, `/exit` — a
   client-side TUI action that never reaches the model). See
   `CONTEXT.md` for the term definitions.
3. **Picker (typed-`/` UX).** Typing `/` opens a filterable inline list
   of every selectable slash command. ↑/↓ to navigate, Enter to select:
   for a Builtin, run on select; for a Skill, fill the buffer with
   `/name ` (cursor at end) and let the user type args. Esc to dismiss.

Pattern is lifted from
`/Users/alexanderopalic/Projects/effectclanker/repos/opencode/packages/opencode/src/skill/index.ts`,
`/Users/alexanderopalic/Projects/effectclanker/repos/opencode/packages/opencode/src/tool/skill.ts`,
`/Users/alexanderopalic/Projects/effectclanker/repos/opencode/packages/opencode/src/session/prompt.ts:1901-1936`,
and (for the picker) opencode's TUI
`/Users/alexanderopalic/Projects/effectclanker/repos/opencode/packages/opencode/src/cli/cmd/tui/context/command-palette.tsx:13-80`
and
`/Users/alexanderopalic/Projects/effectclanker/repos/opencode/packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx:538-797`.
All three surfaces draw from one discovery snapshot built when the
harness layer is constructed; the picker additionally reads a TUI-local
`BUILTINS` registry.

When **Builtin** and **Skill** share a name, the builtin wins and the
skill is dropped from the picker with a `console.warn` at startup. See
`docs/adr/0001-builtin-slash-commands-shadow-skills.md` for rationale.

## Requirements

### Discovery layer

- New module
  `/Users/alexanderopalic/Projects/effectclanker/packages/harness/src/skills.ts`
  exports:

  ```ts
  export interface SkillInfo {
    readonly name: string;
    readonly description: string;
    readonly location: string; // absolute path to SKILL.md
    readonly content: string; // body, frontmatter stripped
  }

  export interface SkillsInterface {
    readonly all: ReadonlyArray<SkillInfo>;
    readonly get: (name: string) => SkillInfo | undefined;
  }

  export class Skills extends Context.Tag("@effectclanker/Skills")<Skills, SkillsInterface>() {}

  export const SkillsLayer: Layer.Layer<Skills>;
  ```

- `SkillsLayer = Layer.effect(Skills, scanAndLoad())` runs discovery once
  when the layer is built. The interface exposes a **synchronous frozen
  snapshot** so the toolkit layer and the slash dispatcher can read it
  without an extra `yield*`.

- Discovery roots, scanned **in this order** (project-local overrides
  global; `.agents` overrides `.claude` within scope):
  1. `path.join(os.homedir(), ".claude", "skills")`
  2. `path.join(os.homedir(), ".agents", "skills")`
  3. `path.join(process.cwd(), ".claude", "skills")`
  4. `path.join(process.cwd(), ".agents", "skills")`

  Non-existent roots are skipped silently. Within each root, look for
  direct child directories (one level deep) whose `SKILL.md` exists. Do
  not recurse below `<root>/<skill-name>/SKILL.md`.

- `SKILL.md` parser is hand-rolled — Claude Code / AGENTS frontmatter
  contains only single-line `key: value` pairs in practice:
  1. File must start with `---\n`. If not, log warn and skip.
  2. Read until the next `---\n` line. Lines between are frontmatter.
  3. Each non-blank line is split on the **first** `:`; both sides
     trimmed.
  4. `name` and `description` are required strings. If either is
     missing, log warn and skip.
  5. The remainder of the file (after the second `---\n`, with a single
     leading newline trimmed) is `content`.

- Conflict resolution: if two skills share a `name`, **last wins**. Order
  is the list above, so a project skill overrides a global skill with
  the same name. Log a `console.warn` describing both locations.

### System-prompt injection (verbose XML, once at session start)

- Extend
  `/Users/alexanderopalic/Projects/effectclanker/packages/harness/src/system-prompt.ts`:

  ```ts
  export const buildEnvironmentSystemPrompt = (env: {
    readonly cwd: string;
    readonly platform: string;
    readonly date: Date;
    readonly skills?: ReadonlyArray<SkillInfo>; // NEW, optional
  }): string;
  ```

  - When `skills` is undefined or empty: today's exact output (env block
    only). No trailing whitespace change.
  - When `skills.length > 0`: append a blank line after `</env>`, then a
    verbose XML block whose shape matches
    `repos/opencode/packages/opencode/src/skill/index.ts:300-313`:

    ```
    <available_skills>
      <skill>
        <name>grill-with-docs</name>
        <description>Stress-test a plan against existing domain model…</description>
        <location>file:///Users/.../grill-with-docs/SKILL.md</location>
      </skill>
      ... sorted by name ascending ...
    </available_skills>
    ```

  - Followed by one explanation line, lifted verbatim from
    `repos/opencode/packages/opencode/src/session/system.ts:71-72`:

    ```
    Skills provide specialized instructions and workflows for specific tasks.
    Use the skill tool to load a skill when a task matches its description.
    ```

- `chatWithEnvironment` accepts the same optional `skills` field and
  threads it into the builder.

### `skill` tool spec + handler

- New file
  `/Users/alexanderopalic/Projects/effectclanker/packages/tools/src/skill.ts`
  exports:

  ```ts
  export const makeSkillTool = (skills: ReadonlyArray<SkillInfo>):
    | { tool: Tool<...>; handler: (input: { name: string }) => Effect<string> }
    | null;
  ```

  - Returns `null` when `skills.length === 0`. Callers skip registration.
  - Otherwise builds:

    ```ts
    const SkillName = Schema.Literals(...skills.map((s) => s.name));

    const tool = Tool.make("skill", {
      description: buildSkillToolDescription(skills), // compact md list
      parameters: { name: SkillName },
      success: Schema.String,
      failureMode: "return",
    });
    ```

- `buildSkillToolDescription(skills)` matches
  `repos/opencode/packages/opencode/src/tool/registry.ts:270-287`:
  an explanation paragraph followed by a compact markdown list
  (`- **name**: description`, sorted by name). No XML here — the verbose
  form is already in the system prompt (see Q3 reasoning, opencode's
  `session/system.ts:73-74`).

- Handler reads adjacent files via
  `fs.promises.readdir(path.dirname(info.location), { recursive: true, withFileTypes: true })`,
  filters to files (excluding `SKILL.md`), and returns a single string
  matching
  `repos/opencode/packages/opencode/src/tool/skill.ts:50-66`:

  ```
  <skill_content name="grill-with-docs">
  # Skill: grill-with-docs

  <body>

  Base directory for this skill: file:///Users/.../grill-with-docs
  Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.

  <skill_files>
  <file>/abs/path/scripts/foo.sh</file>
  ...
  </skill_files>
  </skill_content>
  ```

  Drop the "Note: file list is sampled" line — we do not cap.

- Handler does **not** call any approval gate. Skill loading is
  read-only; downstream `read`/`shell`/`write`/`edit` enforce approval.

### Toolkit wiring

- `/Users/alexanderopalic/Projects/effectclanker/packages/harness/src/toolkit.ts`
  becomes a `Layer.effect` that:
  1. Yields the `Skills` service.
  2. Calls `makeSkillTool(skills.all)`.
  3. When it returns `null`: builds today's toolkit
     (`Toolkit.make(ReadTool, WriteTool, EditTool, ShellTool, GrepTool, GlobTool)`)
     with today's handler map.
  4. When non-null: appends `tool` to the `Toolkit.make(...)` arguments
     and `skill: handler` to the handler map.

- `HarnessToolkitLayer` and `HarnessToolkitLayerBare` keep their export
  names and their effective types from callers' point of view, but their
  construction is now an `Effect.gen` inside `Layer.effect`. They each
  `Layer.provide(SkillsLayer)` so external callers never see the new
  service requirement.

### Builtin command registry

- New module
  `/Users/alexanderopalic/Projects/effectclanker/packages/tui/src/builtin-commands.ts`
  exports the **single source of truth** for builtin slash commands —
  both their metadata (consumed by the picker and `/help`) and their
  dispatch behavior (consumed by `slashCommand`). Replaces today's
  hardcoded switch + `HELP_TEXT` constant in `chat.ts`.

  ```ts
  export interface BuiltinContext {
    readonly chat: Chat.Service;
    readonly clearTo: Prompt.RawInput;
    readonly helpText: string; // pre-computed at dispatch time
  }

  export interface BuiltinCommand {
    readonly name: string; // "help" — no leading slash
    readonly description: string;
    readonly run: (ctx: BuiltinContext) => Effect.Effect<SlashCommandResult>;
  }

  export const BUILTINS: ReadonlyArray<BuiltinCommand> = [
    { name: "exit", description: "Quit the chat", run: () => Effect.succeed({ kind: "quit" }) },
    {
      name: "help",
      description: "Show available slash commands",
      run: ({ helpText }) => Effect.succeed({ kind: "handled", text: helpText }),
    },
    {
      name: "clear",
      description: "Reset conversation history",
      run: ({ chat, clearTo }) =>
        Ref.set(chat.history, Prompt.make(clearTo)).pipe(
          Effect.as({ kind: "cleared", text: "Conversation cleared." }),
        ),
    },
  ];
  ```

- `HELP_TEXT` and the previously specced `HELP_TEXT_WITH_SKILLS` are
  **deleted**. `/help`'s body is derived at invocation time by
  iterating `BUILTINS` plus the shadowing-filtered `skills.all` (see
  next section), e.g.

  ```
  Slash commands:
    /clear — Reset conversation history
    /exit — Quit the chat
    /help — Show available slash commands

  Skills:
    /grill-with-docs — Stress-test a plan…
    /prd — Generate a Product Requirements Document…
  ```

### Slash dispatch

- `/Users/alexanderopalic/Projects/effectclanker/packages/tui/src/chat.ts:29`
  `slashCommand` gains a `skills: SkillsInterface` parameter:

  ```ts
  export const slashCommand = (
    line: string,
    chat: Chat.Service,
    skills: SkillsInterface,           // NEW
    clearTo: Prompt.RawInput = Prompt.empty,
  ): Effect.Effect<SlashCommandResult>;
  ```

- Dispatch order after parsing `head` from `trimmed.slice(1).split(/\s+/u)`:
  1. `BUILTINS.find((b) => b.name === head)` matches a builtin →
     `builtin.run({ chat, clearTo, helpText })`. The dispatcher
     computes `helpText` once via a small `buildHelpText(skills)`
     helper before lookup; only `/help`'s `run` reads it.
  2. `skills.get(head)` matches a skill (and that skill name does
     **not** shadow a builtin — shadowing filter is applied at
     `SkillsLayer` time, see "Shadowing" below) →
     `{ kind: "passthrough", text: renderSkillTemplate(skill.content, args) }`.
  3. Otherwise → `{ kind: "handled", text: "Unknown command: /${head}" }`.
     **Behaviour change** — today's `slashCommand` returns
     `{ kind: "passthrough", text: line }` for unknown slashes; with
     skills wired in, unknown is overwhelmingly a typo. Suppress.

### Shadowing: builtin wins, skill is dropped + warned

- At `SkillsLayer` build time, immediately after the discovery pass,
  filter out any `SkillInfo` whose `name` matches a `BUILTINS[i].name`.
  Log one `console.warn` per dropped skill:

  ```
  Skill "clear" at /Users/x/.claude/skills/clear/SKILL.md is shadowed by
  builtin /clear and will not be invokable. Rename the skill folder to
  use it.
  ```

- Dropping at discovery (not at dispatch) keeps a single filtered list
  flowing to every consumer: the `skill` tool's `Schema.Literals` enum,
  the `<available_skills>` system-prompt block, the picker, and the
  `/help` text. No consumer has to remember to re-apply the filter.

- Rationale lives in
  `/Users/alexanderopalic/Projects/effectclanker/docs/adr/0001-builtin-slash-commands-shadow-skills.md`.

- `renderSkillTemplate(body, args)` in the same module:
  - If `body.includes("$ARGUMENTS")`: return `body.replaceAll("$ARGUMENTS", args.trim())`.
  - Else if `args.trim().length > 0`: return `body + "\n\n" + args.trim()`.
  - Else: return `body`.

  Numbered placeholders (`$1`/`$2`) are not supported.

- The transcript continues to show the user's literal `line`. The
  passthrough path in
  `/Users/alexanderopalic/Projects/effectclanker/packages/tui/src/chat-runtime.tsx:98-99`
  already does `controller.appendUser(line)` before
  `runChatTurn({ prompt: result.text })`, so showing the original line
  while sending the rendered body falls out for free — no
  `SlashCommandResult` variant added.

### Slash-command picker

The user-facing complement to `slashCommand`: typing `/` in the chat
input opens an inline filterable list of every selectable slash
command. The picker is purely presentational — selection rewrites the
draft, dispatch always goes through `slashCommand` on the same
submit path the user would hit by typing.

- New module
  `/Users/alexanderopalic/Projects/effectclanker/packages/tui/src/slash-commands.ts`
  exports:

  ```ts
  export interface SlashCommandEntry {
    readonly trigger: string; // "/help", "/grill-with-docs"
    readonly description: string;
    readonly source: "builtin" | "skill";
  }

  export const listSlashCommands = (
    skills: ReadonlyArray<SkillInfo>, // already shadow-filtered
  ): ReadonlyArray<SlashCommandEntry> => [
    ...BUILTINS.map((b) => ({
      trigger: `/${b.name}`,
      description: b.description,
      source: "builtin" as const,
    })),
    ...skills.map((s) => ({
      trigger: `/${s.name}`,
      description: s.description,
      source: "skill" as const,
    })),
  ];

  export const filterSlashCommands = (
    draft: string,
    all: ReadonlyArray<SlashCommandEntry>,
  ): ReadonlyArray<SlashCommandEntry> => {
    if (!draft.startsWith("/") || draft.includes(" ")) return [];
    const query = draft.slice(1);
    return all.filter((entry) => entry.trigger.slice(1).startsWith(query));
  };
  ```

  Pure functions; no Ink, no Effect. Unit-testable from
  `packages/tui/test/slash-commands.test.ts`.

- `runChatApp` in
  `/Users/alexanderopalic/Projects/effectclanker/packages/tui/src/chat-runtime.tsx`
  computes the snapshot **once** at startup and passes it to
  `<ChatApp slashCommands={listSlashCommands(skills.all)} ... />`.
  No live updates — discovery doesn't run mid-session (see Out of
  scope: "Mid-session skill reload").

- Picker state lives in `ChatApp` as React-local `useState`. **Not** in
  `ChatStateController` — turn-lifecycle state is what the controller
  owns; ephemeral UI state belongs alongside `draft` / `copyToast`
  (precedent: `chat-ui.tsx:297-299`). Variables:

  ```ts
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [editVersion, setEditVersion] = useState(0);
  ```

  - **`selectedIndex`** — which filtered entry is highlighted. Reset
    to 0 whenever the filter changes.
  - **`dismissed`** — the draft string at the moment the user pressed
    Esc, or `null`. Picker hides while `dismissed === draft`. Any
    `setDraft` to a different value resets `dismissed` to `null`.
  - **`editVersion`** — bumped on every programmatic `setDraft`
    (picker-driven selection). Passed as `key` to `<TextInput>`. See
    `docs/patterns/ink-gotchas.md` §"Programmatic `value` changes
    don't move the cursor to the end" — this is how we put the cursor
    at the end after rewriting the buffer.

- Picker visibility is **derived**, not stored:

  ```ts
  const filtered = useMemo(() => filterSlashCommands(draft, slashCommands), [draft, slashCommands]);
  const pickerVisible = filtered.length > 0 && dismissed !== draft;
  ```

  - Type a space → filter returns `[]` → picker hides.
  - Backspace past `/` → `draft.startsWith("/")` is false → hides.
  - Submit → `draft` becomes `""` → hides.
  - Esc → `setDismissed(draft)` → hides until the next keystroke
    changes `draft`.

- Keyboard handling — `ink-text-input` ignores `key.upArrow`,
  `key.downArrow`, `key.tab`, `key.shift && key.tab` (see
  `docs/patterns/ink-gotchas.md`), so our `useInput` consumes them
  freely:

  ```ts
  useInput((input, key) => {
    if (pickerVisible) {
      if (key.upArrow) {
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (key.escape) {
        setDismissed(draft);
        return;
      }
    }
    // ...existing handlers (Ctrl+C, Ctrl+E, approval keys)
  });
  ```

  Enter is the only key both `useInput` and `TextInput.onSubmit` would
  claim; **route the branch through `onSubmit` only**, never both
  (Ink does not guarantee handler ordering):

  ```ts
  onSubmit={(value) => {
    if (pickerVisible) {
      const entry = filtered[selectedIndex];
      if (entry === undefined) return;
      if (entry.source === "builtin") {
        setDraft("");
        setEditVersion((v) => v + 1);
        onSubmit(entry.trigger);             // dispatcher path; clears history etc.
      } else {
        setDraft(`${entry.trigger} `);
        setEditVersion((v) => v + 1);        // cursor → end
        setSelectedIndex(0);
      }
      return;
    }
    if (state.status === "streaming") return;
    if (pendingApproval !== null) return;
    if (value.length === 0) return;
    setDraft("");
    onSubmit(value);
  }}
  ```

- Rendering — inline above the input box, below the footer. Ink has no
  z-index / overlay; the picker is just another `<Box>` in the existing
  flex column at `chat-ui.tsx:396-494`. When `pickerVisible`, the
  transcript reflows up by `Math.min(filtered.length, 10)` rows; when
  it hides, content reflows back. Layout:

  ```
  <Box flexDirection="column" borderStyle="round" borderColor={...}>
    {filtered.slice(0, 10).map((entry, i) => (
      <Box key={entry.trigger}
           backgroundColor={i === selectedIndex ? USER_BG : undefined}>
        <Text bold>{entry.trigger.padEnd(longestTriggerWidth + 2)}</Text>
        <Text dimColor>{entry.description}</Text>
        <Text dimColor>{`  [${entry.source}]`}</Text>
      </Box>
    ))}
  </Box>
  ```

  Cap at 10 visible rows (mirrors opencode
  `autocomplete.tsx:801-805`). If `filtered.length > 10`, the
  remainder is just truncated — no scrolling state machine until
  someone actually hits the cap with a real population. The `[builtin]`
  / `[skill]` tag is the dim trailing badge from Q7.

- Pi-style placeholder hint at `chat-ui.tsx:402` (`type a prompt,
/help for commands`) becomes truthful once `/help` exists — no edit
  needed, just spec compliance.

- `runChatApp` in
  `/Users/alexanderopalic/Projects/effectclanker/packages/tui/src/chat-runtime.tsx:21`
  yields `Skills` and:
  1. Passes `skills.all` to `chatWithEnvironment({ cwd, platform, date, skills: skills.all })`.
  2. Passes `skills` to every `slashCommand(line, chat, skills, seedPrompt)` call.

- `runCommand` in
  `/Users/alexanderopalic/Projects/effectclanker/packages/cli/src/cli.ts:79`
  does the same single-shot equivalent: yield `Skills`, pass `skills.all`
  to `chatWithEnvironment`.

### Re-exports

- `/Users/alexanderopalic/Projects/effectclanker/packages/harness/src/index.ts`
  re-exports: `SkillInfo`, `Skills`, `SkillsLayer`, `SkillsInterface`.

- `/Users/alexanderopalic/Projects/effectclanker/packages/tools/src/index.ts`
  re-exports: `makeSkillTool`.

## Implementation hints

- Reference frontmatter validator:
  `/Users/alexanderopalic/Projects/effectclanker/repos/opencode/packages/opencode/src/skill/index.ts:52-58`
  (`isSkillFrontmatter`). Same predicate shape — `name: string` required,
  `description: string` required (we tighten to required vs opencode's
  optional).

- Reference verbose-XML formatter:
  `/Users/alexanderopalic/Projects/effectclanker/repos/opencode/packages/opencode/src/skill/index.ts:296-321`
  (`Skill.fmt`).

- Reference tool description:
  `/Users/alexanderopalic/Projects/effectclanker/repos/opencode/packages/opencode/src/tool/registry.ts:270-287`
  (`describeSkill`).

- Reference tool output template:
  `/Users/alexanderopalic/Projects/effectclanker/repos/opencode/packages/opencode/src/tool/skill.ts:50-66`.
  Mirror exactly except no file-cap and no "list is sampled" wording.

- Reference template-render algorithm:
  `/Users/alexanderopalic/Projects/effectclanker/repos/opencode/packages/opencode/src/session/prompt.ts:1917-1936`.
  Their algorithm supports numbered placeholders + `$ARGUMENTS` +
  append-fallback. We keep only the last two branches.

- **Empirical reason we use verbose-XML in system prompt and compact
  markdown in tool description:**
  `/Users/alexanderopalic/Projects/effectclanker/repos/opencode/packages/opencode/src/session/system.ts:73-74`
  ("the agents seem to ingest the information about skills a bit better
  if we present a more verbose version of them here and a less verbose
  version in tool description, rather than vice versa"). Worth pinning
  in `docs/patterns/effect-ai-gotchas.md` once shipped.

- `Schema.Literals(...skills.map((s) => s.name))` accepts a string-tuple;
  the provider will send a JSON-schema enum to the model. The model
  cannot call the tool with an unknown name. Empty arrays are invalid
  for `Schema.Literals` — gate at `makeSkillTool` with the
  `length === 0 → null` early return.

- File listing: `fs.promises.readdir(dir, { recursive: true, withFileTypes: true })`
  then `.filter((e) => e.isFile() && e.name !== "SKILL.md")` then
  `.map((e) => path.join(e.parentPath, e.name))`. No new dep, no
  ripgrep, no `Glob.scan`.

- `pathToFileURL` from `node:url` for `<location>` and
  `Base directory for this skill:` URLs.

- For tests that need to stage a `.claude/skills/` tree, **inject the
  roots** rather than hard-coding `os.homedir()` / `process.cwd()` in
  `SkillsLayer`. Export an internal `scanSkills(roots: string[]): Effect<SkillInfo[]>`
  that the public layer calls with the production roots, and that tests
  call with `withTmpDir`-staged roots. Same pattern as
  `packages/tools/src/` handlers that take their I/O paths as inputs.

- The system-prompt extension is a pure string-concat. The existing test
  for "env block only" stays valid by passing `skills: []` (or
  omitting). Add new tests; don't edit existing ones.

- Mock toolkit-via-mock pattern: `packages/harness/test/toolkit.test.ts`
  already has a working `runToolkit({ prompt, parts: [mockToolCall(...)] })`
  helper. Add one case where the mock emits
  `mockToolCall("skill", { name: "fake" })` and assert the result text
  contains `<skill_content name="fake">`.

- The `Effect.acquireUseRelease`-based `withTmpDir` already exists in
  `packages/tools/test/utilities.ts` and is duplicated under
  `packages/harness/test/utilities.ts` / `packages/tui/test/utilities.ts`
  per the architecture note in
  `/Users/alexanderopalic/Projects/effectclanker/docs/architecture.md`.
  Use whichever sibling lives in the package under test.

- Reference picker registry shape:
  `repos/opencode/packages/opencode/src/cli/cmd/tui/context/command-palette.tsx:13-80`
  (`SlashEntry` + `slashes()` accessor). Our `SlashCommandEntry` is the
  same idea minus the `aliases` field (we don't have command aliases
  yet) and minus the embedded `onSelect` closure (dispatch goes through
  `slashCommand`, not per-entry callbacks).

- Reference picker filtering + on-select branching:
  `repos/opencode/packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx:538-565`
  (builds the slash list, custom-source-rewrites-buffer-on-select),
  `:760-797` (show/hide rules — trigger at `/`, hide on whitespace).
  Our derived-visibility model replaces opencode's explicit
  `visible: false | "@" | "/"` store; we don't need `@`-mention
  autocomplete in v1.

- **Ink-text-input quirks consulted by the picker:**
  `docs/patterns/ink-gotchas.md` documents the load-bearing facts —
  that the input ignores `key.upArrow` / `key.downArrow` / `key.tab`
  (we claim those for navigation), that `key.return` is shared with
  the input's `onSubmit` (we branch Enter inside `onSubmit`, never via
  `useInput`), and that programmatic `setDraft` doesn't move the
  cursor (the `editVersion`-as-`key` remount fixes it).

- **Builtin/skill shadowing precedence:**
  `docs/adr/0001-builtin-slash-commands-shadow-skills.md` records why
  builtins win and skills get dropped+warned rather than the reverse.

## Acceptance criteria

TDD order — write the first test, watch it fail, then make it pass. Then
the next.

### Discovery

- [ ] **Red:** `packages/harness/test/skills.test.ts` →
      `it.effect("scanSkills parses name+description+content from a SKILL.md", ...)`.
      `withTmpDir` stages `.claude/skills/foo/SKILL.md` with frontmatter
      `name: foo` / `description: a foo` + body `hello`. Asserts
      returned array has one entry with `name === "foo"`,
      `description === "a foo"`, `content === "hello"`,
      `location` is the absolute path.
- [ ] **Green:** same test passes after `scanSkills` exists.
- [ ] `it.effect("skips non-existent roots silently", ...)` — passes a
      root that doesn't exist alongside one that does; non-existent
      root contributes nothing.
- [ ] `it.effect("ignores SKILL.md missing the leading --- fence", ...)`
      — no entry returned, warn logged (verify via captured stderr or a
      logger spy — pick whichever sibling pattern is already in use).
- [ ] `it.effect("requires both name and description", ...)` — a
      SKILL.md with only `name:` is skipped with a warn.
- [ ] `it.effect("later root overrides earlier root for the same name", ...)`
      — two roots staged, both with `foo`. Asserts the resulting
      `SkillInfo.location` points at the **second** root's file, and a
      warn was logged citing both paths.
- [ ] `it.effect("scans direct subdirs only, not <root>/SKILL.md or <root>/a/b/SKILL.md", ...)`
      — staged decoys at the root and two levels deep do not appear.

### System-prompt injection

- [ ] `it.effect("omits <available_skills> when skills is undefined", ...)`
      — output is byte-equal to today's `buildEnvironmentSystemPrompt`
      output. Existing tests stay untouched.
- [ ] `it.effect("omits <available_skills> when skills is empty array", ...)`
      — same as above.
- [ ] `it.effect("appends verbose <available_skills> block sorted by name", ...)`
      — passes two `SkillInfo`s out of order (`zebra`, `apple`); output
      contains `<skill><name>apple</name>` before
      `<skill><name>zebra</name>`. Output also contains the explanation
      line lifted from opencode.
- [ ] `it.effect("emits <location> as a file:// URL", ...)` — passes a
      `SkillInfo` with `location: /tmp/x/SKILL.md`; output contains
      `<location>file:///tmp/x/SKILL.md</location>`.

### `skill` tool

- [ ] **Red:** `packages/tools/test/skill.test.ts` →
      `it.effect("handler renders skill body, base directory, and adjacent files", ...)`.
      Handler-direct call with a staged SKILL.md and `scripts/foo.sh`.
      Asserts the returned string contains:
      `<skill_content name="…">`, `# Skill: …`, the body, the
      `Base directory for this skill: file:///…` line, the relative-paths
      note, `<skill_files>`, the `<file>/abs/path/scripts/foo.sh</file>`
      entry, `</skill_files>`, and `</skill_content>`.
- [ ] `it.effect("file list excludes SKILL.md itself", ...)`.
- [ ] `it.effect("makeSkillTool returns null when given empty list", ...)`.
- [ ] `it.effect("parameter schema is a Schema.Literals enum of the discovered names", ...)`
      — decode `{ name: "valid" }` succeeds, decode `{ name: "bogus" }`
      yields a `ParseError`. Use `Schema.decodeUnknown` directly on the
      built tool's parameter struct.

### Toolkit dispatch

- [ ] `packages/harness/test/toolkit.test.ts` →
      `it.effect("toolkit dispatches a skill call and emits content back", ...)`
      — mock model emits `mockToolCall("skill", { name: "foo" })`; the
      captured tool-result content contains `<skill_content name="foo">`
      and the body.
- [ ] `it.effect("toolkit registers only the six base tools when no skills are discovered", ...)`
      — provide `Layer.succeed(Skills, { all: [], get: () => undefined })`;
      assert the toolkit's `tools` array has length 6 and no entry
      named `skill`.

### Slash dispatch

- [ ] `packages/tui/test/chat.test.ts` →
      `it.effect("/<skill> renders body as passthrough", ...)` — provides
      a stub `SkillsInterface` with one skill whose body is `BODY`;
      `slashCommand("/foo", chat, skills)` returns
      `{ kind: "passthrough", text: "BODY" }`.
- [ ] `it.effect("$ARGUMENTS is replaced with the trimmed arg string", ...)`
      — body is `pre $ARGUMENTS post`; `slashCommand("/foo bar baz", ...)`
      returns `text: "pre bar baz post"`.
- [ ] `it.effect("body without $ARGUMENTS appends args with double newline", ...)`
      — body is `BODY`; `slashCommand("/foo hello", ...)` returns
      `text: "BODY\n\nhello"`.
- [ ] `it.effect("body without $ARGUMENTS and no args returns body unchanged", ...)`.
- [ ] `it.effect("unknown slash returns handled error, not passthrough", ...)`
      — `slashCommand("/typo", chat, skills)` returns
      `{ kind: "handled", text: "Unknown command: /typo" }`.
- [ ] `it.effect("built-in /clear wins over a skill named clear via shadowing filter", ...)`
      — `SkillsLayer` is given a `clear` skill; the resulting
      `skills.all` does **not** contain it (filtered at discovery), and
      `slashCommand("/clear", ...)` returns `{ kind: "cleared", ... }`.
- [ ] `it.effect("shadowed skill triggers console.warn at layer build", ...)`
      — stage a `clear` skill, assert one warn is logged citing the
      file path + `/clear` builtin.
- [ ] `it.effect("BUILTINS is the sole source of builtin metadata for /help", ...)`
      — append a fake entry to `BUILTINS` for the test (use the
      registry directly, not a string copy); `/help` output mentions
      the fake entry's `description`.
- [ ] `it.effect("/help includes discovered skill names when non-empty", ...)`
      — output text contains `/foo — <description>` for each skill,
      grouped under a `Skills:` header.

### Slash-command picker

Picker logic is pure functions exported from `slash-commands.ts`; the
React-Ink component is exercised manually for now (no `ink-testing-library`
dep yet — defer until a behaviour bug actually warrants it).

- [ ] `packages/tui/test/slash-commands.test.ts` →
      `it("filterSlashCommands returns [] for non-slash drafts", ...)`
      — `filterSlashCommands("hello", entries)` is `[]`.
- [ ] `it("filterSlashCommands returns [] once a space appears", ...)`
      — `filterSlashCommands("/foo bar", entries)` is `[]`.
- [ ] `it("filterSlashCommands prefix-matches trigger names", ...)`
      — entries include `/help`, `/clear`, `/grill-with-docs`;
      `filterSlashCommands("/h", entries)` returns `/help` only;
      `filterSlashCommands("/", entries)` returns all three.
- [ ] `it("listSlashCommands prefixes builtins then skills", ...)`
      — given `BUILTINS` and a one-skill array, the resulting array
      starts with builtins in source order and ends with skills.
- [ ] `it("listSlashCommands stamps source correctly", ...)`
      — entry for `/help` has `source: "builtin"`, entry for
      `/foo` (the test skill) has `source: "skill"`.

### Integration smoke

- [ ] `packages/cli/src/cli.ts:79` and
      `packages/tui/src/chat-runtime.tsx:21` both yield `Skills` and
      pass `skills.all` into `chatWithEnvironment`. Smoke check by
      reading the diff.

### Repo hygiene

- [ ] No `setTimeout`, no real LLM calls, no flaky waits.
- [ ] `bun run check` passes (typecheck, lint, format, tests).
- [ ] `docs/patterns/effect-ai-gotchas.md` gains a short subsection
      titled "Skills: verbose XML in system prompt, compact markdown in
      tool description" with the empirical citation from
      `repos/opencode/.../session/system.ts:73-74`.

## Out of scope

- **Mid-session skill reload.** Discovery runs once at layer build. Add
  a new SKILL.md and you need to restart the chat (or `/clear` does
  **not** trigger rediscovery — it just resets history). A `chokidar`
  watcher is doable later but not in v1.
- **Numbered placeholders `$1` / `$2` / `$N`.** Opencode supports them;
  most Claude-Code skills don't use them. Add later if a real skill
  needs them.
- **MCP-prompt-as-command registration.** Opencode merges MCP prompts
  into the same `Command` registry as skills. There is no MCP
  integration in effectclanker yet.
- **Per-agent permission filtering of skills**
  (`repos/opencode/...src/skill/index.ts:277-282`). There is no `Agent`
  concept here yet. All skills are visible to the only model in town.
- **Fuzzy filtering in the picker.** Prefix match only — `/g` shows
  every entry whose trigger starts with `/g`. opencode uses `fuzzysort`
  (`autocomplete.tsx:592-611`); we don't take the dep. At populations
  under ~50 entries, prefix matching is plenty. Revisit if a real
  skill load reaches the point where users miss it.
- **Scrolling inside the picker.** Cap at 10 visible rows; if a
  filtered population exceeds that, the remainder is truncated until
  the user narrows the query. No keyboard scroll state machine.
- **Source-grouped picker layout** (separate "Builtins" / "Skills"
  sections). Picker is one flat alphabetical-ish list with a dim
  trailing `[builtin]` / `[skill]` tag per entry.
- **URL-pulled skills** (opencode's `skills.urls` config / `Discovery.pull`
  in `repos/opencode/.../skill/discovery.ts`). Out of scope until there
  is a config file at all.
- **Multi-line YAML frontmatter, folded scalars, nested keys, comments.**
  Parser only handles single-line `key: value` pairs. Frontmatter
  outside that shape is silently ignored or causes the skill to be
  skipped with a warn.
- **`metadata:` and other frontmatter fields.** Only `name` and
  `description` are read; the rest is dropped.
- **Approval gating of the `skill` tool itself.** Auto-approved
  everywhere — the tool is read-only; the model still has to call
  `read` / `shell` to act on bundled resources.
- **A built-in `/skills` listing command.** `/help` already enumerates
  them. Add `/skills` later if `/help` grows too long.
- **Re-deriving the verbose-XML system prompt every turn.** It's
  baked into the seeded `Chat` history at session start, same as the
  env block. If the user edits a SKILL.md mid-session, they need a
  restart.
- **Bash backtick substitution in skill bodies**
  (`repos/opencode/.../session/prompt.ts:1938-1949`). Skill content is
  injected verbatim; no shell side effects at render time.
