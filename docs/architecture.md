# Architecture

## Packages

The codebase is split into four Bun workspaces under `packages/`, with strict
downward layering (`cli → tui → harness → tools`):

| Package                  | Owns                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@effectclanker/tools`   | `Tool.make` specs + handlers, `errors.ts`, `ApprovalPolicy` tag + pure (auto / deny) layers, `PlanStore`.                                                                                  |
| `@effectclanker/harness` | `HarnessToolkit` composition + `HarnessToolkitLayerBare` / `HarnessToolkitLayer`, `ApprovalInteractiveLayer`.                                                                              |
| `@effectclanker/tui`     | Ink chat layer (`chat-runtime.tsx`, `chat-ui.tsx`, `chat-state.ts`, `chat.ts`, `clipboard.ts`), `ApprovalInkLayer` + the `ApprovalInk` queue tag, and the `Auto`/`DenyAll` Ink companions. |
| `@effectclanker/cli`     | `@effect/cli` entry point with `run` and `chat` subcommands; the `bin` target.                                                                                                             |

A package can skip levels (the cli imports `@effectclanker/tools` directly for
`PlanStore`, `ApprovalAutoApproveLayer`, etc.) but never reaches upward. Each
`packages/<name>/test/package-boundary.test.ts` reads the manifest and locks
the rule in.

### Two deliberate boundary decisions

These look fixable until you understand why:

- **`ApprovalDenied` lives in `packages/tools/src/errors.ts`** even though the
  approval layers in `harness` (interactive) and `tui` (Ink) both `throw` it.
  Errors are low; layers above import them. There's no circular dep — the
  upper packages depend on `tools` and reuse the error tag, which is exactly
  the layering working as intended.
- **`test/utilities.ts` is duplicated, not shared.** Each package's `test/`
  has its own `withTmpDir` / `expectLeft` / `withLanguageModel` (the harness
  copies the fs helpers from tools; tui re-exports). We chose two extra copies
  of ~10 lines over a `packages/test-utils` workspace — the workspace would
  cost more in `package.json`, `tsconfig`, and resolution complexity than it
  would save. Resist consolidating.

## Three Effect-AI layers

Three layers, in increasing order of abstraction. `@effect/ai` provides all
three; we provide concrete instances.

```
LanguageModel  ←  drives a multi-turn conversation
     ↑
Toolkit        ←  composes tools + their handlers
     ↑
Tool           ←  a single named capability with a typed input + output
```

## Layer 1 — `Tool`

A `Tool` is a typed spec for a single capability the model can invoke. Five
fields:

| Field         | What it is                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `name`        | The identifier the model uses (`"read"`, `"shell"`, …)                                               |
| `description` | Free-text shown to the model. Shapes when it picks the tool.                                         |
| `parameters`  | A `Schema.Struct.Fields` record — the input shape.                                                   |
| `success`     | `Schema.Schema` for a successful result.                                                             |
| `failure`     | `Schema.Schema` for a typed failure (defaults to `Schema.Never`).                                    |
| `failureMode` | `"return"` or `"error"`. **Always `"return"` here.** See [gotchas](./patterns/effect-ai-gotchas.md). |

Tools have no implementation — they're pure specs. Per-tool files in
`packages/tools/src/` export both the `Tool` and a separate `handler` function.

The provider (Anthropic / OpenAI) converts `parameters` to JSON Schema
automatically when sending the tool list to the model. We never call
`JSONSchema.make` ourselves.

## Layer 2 — `Toolkit`

`Toolkit.make(ToolA, ToolB, ...)` composes tools into a value the
`LanguageModel` can use. The toolkit is then wired to its handlers via
`.toLayer({ toolA: handlerA, toolB: handlerB })`, producing a Layer the
runtime provides.

```ts
// packages/harness/src/toolkit.ts
export const HarnessToolkit = Toolkit.make(
  ReadTool,
  WriteTool,
  EditTool,
  ShellTool,
  GrepTool,
  GlobTool,
);

export const HarnessToolkitLayer = HarnessToolkit.toLayer({
  read: readHandler,
  write: writeHandler,
  // ...
});
```

The handler signatures are inferred from each `Tool.make` spec — if the
spec and handler drift, `.toLayer({...})` stops typechecking.

## Layer 3 — `LanguageModel`

`LanguageModel` is a `Context.Tag` exposing `generateText` and `streamText`.
You provide it via a provider layer (here: `AnthropicLanguageModel.layer`
on top of `AnthropicClient.layer`).

A single `LanguageModel.generateText({ prompt, toolkit })` call runs the
**entire multi-turn loop internally** — call the model, dispatch tool
calls through the toolkit's handlers, append results, call again, until
the model emits a final text response. See
[patterns/effect-ai-gotchas.md](./patterns/effect-ai-gotchas.md#3-dont-write-the-turn-loop-yourself).

## Dataflow: prompt → response

```
1. User runs:  bun packages/cli/src/cli.ts run "list ts files"
                                   │
                                   ▼
2. @effect/cli parses args  ─→  runCommand handler
                                   │
                                   ▼
3. LanguageModel.generateText({ prompt, toolkit: HarnessToolkit })
                                   │
                                   ▼
4. Anthropic API call  ──→  response with `tool_use` block(s)
                                   │
                                   ▼
5. Each tool call dispatched to its handler via HarnessToolkitLayer
   (read → readHandler, glob → globHandler, …)
                                   │
                                   ▼
6. Handler runs `node:fs.readFile` / `spawn("sh", ...)` / etc.
                                   │
                                   ▼
7. Handler result encoded as toolResult, fed back to Anthropic
                                   │
                                   ▼
8. Loop continues until model emits text with no tool calls
                                   │
                                   ▼
9. generateText returns GenerateTextResponse {
     text, toolCalls, toolResults, finishReason
   }
                                   │
                                   ▼
10. CLI pretty-prints to stdout
```

Steps 4–8 happen entirely inside `@effect/ai`. We don't see them unless
we use `streamText` instead.

## Why this shape

It mirrors Codex's separation between **registry** (which tools exist),
**router** (dispatch by name), and **orchestrator** (the turn loop), but
each part is provided by `@effect/ai` instead of being hand-rolled. See
the squashed `repos/codex/codex-rs/core/src/` for the original — in
particular `tools/registry.rs`, `tools/router.rs`, and
`session/turn.rs`. The TypeScript version is much smaller because
`@effect/ai` does the heavy lifting.

We **used to** maintain our own `Tool`/`Registry`/`Router`/`runTurn`
modules. Read the git log of this directory if you're curious; they
were deleted in favour of the package.
