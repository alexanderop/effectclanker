# Adding a new tool

The most common task in this codebase. Five steps.

Before you start, skim [architecture](../architecture.md) so you know what
a `Tool` vs `Toolkit` vs `LanguageModel` is.

---

## 1. Create `packages/tools/src/<name>.ts`

Each tool file exports two things: the `Tool.make` spec and a handler
function. Copy any existing tool as a template — `packages/tools/src/read.ts`
is the simplest.

```ts
// packages/tools/src/example.ts
import { Tool } from "@effect/ai";
import { Effect, Schema } from "effect";

export const ExampleTool = Tool.make("example", {
  description: "What the tool does. Shown to the model — write it well.",
  parameters: {
    target: Schema.String,
    count: Schema.optional(Schema.Number),
  },
  success: Schema.Struct({ ok: Schema.Boolean, message: Schema.String }),
  failure: Schema.String,
  failureMode: "return", // see gotchas — always "return"
});

export interface ExampleParams {
  readonly target: string;
  readonly count?: number | undefined;
}

export const exampleHandler = ({
  count,
  target,
}: ExampleParams): Effect.Effect<{ ok: boolean; message: string }, string> =>
  Effect.tryPromise({
    try: async () => ({ ok: true, message: `did ${count ?? 1}× ${target}` }),
    catch: (e) => String(e),
  });
```

### Rules

- **Always set `failureMode: "return"`** if you declare a `failure` schema.
  Default (`"error"`) makes the entire `generateText` reject on tool
  failure. See [gotchas §1](../patterns/effect-ai-gotchas.md#1-set-failuremode-return-on-every-fallible-tool).
- **Always export both `Tool` and `Handler`.** The handler must be testable
  in isolation (see [testing](./testing.md)).
- **Handler param type = `interface FooParams`.** Don't try to derive it
  with `Schema.Schema.Type<...>` — the ergonomics are worse, and drift
  between the interface and the parameters schema is caught by `.toLayer`
  in step 2.
- **Handler success type matches `success` schema, handler failure type
  matches `failure` schema** (typically `string`).
- **No `Effect.async` unless you have a callback API.** Prefer
  `Effect.tryPromise({ try, catch })`. `shell` is the only legitimate
  `Effect.async` use case in the codebase.

## 2. Register in `packages/harness/src/toolkit.ts`

Add the tool to `Toolkit.make` and its handler to `.toLayer`:

```ts
import { ExampleTool, exampleHandler } from "@effectclanker/tools";

export const HarnessToolkit = Toolkit.make(
  ReadTool,
  WriteTool,
  EditTool,
  ShellTool,
  GrepTool,
  GlobTool,
  ExampleTool,
);

export const HarnessToolkitLayer = HarnessToolkit.toLayer({
  read: readHandler,
  // ... existing
  example: exampleHandler,
});
```

If you forget either side, TypeScript fails the build. The `.toLayer`
record type is derived from `Toolkit.make`'s arguments.

## 3. Re-export from `packages/tools/src/index.ts`

So consumers in `harness`/`tui`/`cli` (and your own tests) can `import
{ ExampleTool, exampleHandler } from "@effectclanker/tools"` without
reaching into the package's internal layout:

```ts
export { exampleHandler, type ExampleParams, ExampleTool } from "./example.ts";
```

## 4. Write tests

Two layers, both required for a new tool:

**Handler-direct test** in `packages/tools/test/example.test.ts`. Calls
the exported handler with concrete params. Fast, focused, easy to debug.

**Toolkit-via-mock test** — if the new tool has interesting failure
modes, add a case to `packages/harness/test/toolkit.test.ts` that drives
`generateText` with a scripted tool call. This proves the spec ↔ handler
↔ Toolkit wiring works end-to-end.

See [testing](./testing.md) for the patterns and helpers.

## 5. Run `bun run check`

If everything passes, you're done. If TypeScript complains, it's almost
always because the handler's param destructuring or return type doesn't
match the `Tool.make` spec. Fix the spec or the handler so they agree —
`.toLayer({...})` is the cross-check.

---

## Anti-patterns

- **A "tool that calls the model"**. Tools should be deterministic
  capabilities (read a file, run a command). Recursive agent calls
  belong outside the toolkit.
- **Hidden side effects in `Tool.make`**. The spec is pure metadata.
  Don't reach for global state, don't read env vars, don't allocate
  resources. That's what the handler is for.
- **`Schema.Unknown` in `parameters`**. The whole point of the typed
  schema is the model gets a meaningful JSON Schema. `Schema.Unknown`
  defeats it.
