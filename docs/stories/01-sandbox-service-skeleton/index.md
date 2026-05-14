# Story 01 — `Sandbox` service skeleton (no-op default layer)

> Epic 1 / Story 1 from [`docs/backlog.md`](../../backlog.md).
> Estimated size: **half a day** for a junior who has skimmed `docs/index.md`.
>
> **Stale paths/identifiers — needs reauthoring before pickup.** This spec
> predates two refactors: (1) the monorepo split, so `src/tools/bash.ts` is
> now `packages/tools/src/shell.ts` (and `test/tools/bash.test.ts` is
> `packages/tools/test/shell.test.ts`); (2) the rename of the shell tool
> from `bash` to `shell` (see [gotchas §4](../../patterns/effect-ai-gotchas.md#4-anthropic-reserves-a-handful-of-tool-names)).
> Read symbols `bashHandler`/`BashTool`/`BashError` below as
> `shellHandler`/`ShellTool`/`ShellError`.

## In one sentence

Add a new `Sandbox` Effect service to `src/services/`, modelled on `ApprovalPolicy`,
with a single `run(command, policy)` method and a default **no-op** layer that
just shells out exactly like today. Wire it into `bashHandler` so existing tests
stay green, and add typed policy values that mirror Codex's `SandboxPolicy` enum.

You are **not** implementing Seatbelt, Landlock, or any real sandbox in this
story. Those are stories 2 and 3 of Epic 1. This story builds the seam they
will plug into.

---

## Definition of done

- [ ] `src/services/sandbox.ts` exists and exports:
  - `SandboxPolicy` — a tagged `Schema.Union` of `ReadOnly`, `WorkspaceWrite`, `DangerFullAccess`.
  - `Sandbox` — a `Context.Tag` whose service has a single `run` method.
  - `SandboxNoopLayer` — a `Layer` that fulfils `Sandbox` by delegating directly to `@effect/platform`'s `Command`, with **no** restrictions applied.
- [ ] `src/tools/bash.ts` calls `Sandbox.run(...)` instead of `Command.start(cmd)` directly. The handler's `R` channel now includes `Sandbox`.
- [ ] `src/toolkit.ts`'s `HarnessToolkitLayerBare` captures `Sandbox` in its `Effect.context<...>` tuple, and `HarnessToolkitLayer` provides `SandboxNoopLayer`.
- [ ] `src/cli.ts` provides `SandboxNoopLayer` inside `runCommand`. (CLI flag arrives in story 4 — not now.)
- [ ] `test/tools/bash.test.ts` provides `SandboxNoopLayer` in every test. All existing assertions still pass.
- [ ] A new `test/services/sandbox.test.ts` covers: (a) the no-op layer runs a real command, (b) `SandboxPolicy` decodes the three variants from JSON.
- [ ] `bun run check` is green end-to-end.

No new CLI flags, no Seatbelt code, no JSON config files. Just the seam.

---

## Why this exists (in 60 seconds)

Today the harness `bash` tool spawns `sh -c <command>` straight through
`@effect/platform`'s `Command.start`. Nothing is sandboxed. In auto-approval
mode, the model has unrestricted shell on the user's machine — which limits how
much we can trust it.

Codex solves this with a `SandboxManager` (Rust) that wraps every shell call
on macOS in `sandbox-exec` and on Linux in `bwrap`/Landlock. Before we can do
either, we need an **abstraction**: a single point where every shell call goes
through, so swapping the implementation later is a one-line change.

That abstraction is the `Sandbox` service. This story builds **only** that
abstraction, with a no-op default so behaviour doesn't change. The real
sandbox backends come in stories 2 (Seatbelt) and 3 (Landlock).

> **The principle:** introduce the seam first, with a layer that preserves
> current behaviour, then replace the layer's body. This is how every other
> service in this codebase was introduced — see `ApprovalAutoApproveLayer` (a
> no-op layer that mirrors Codex's `AskForApproval::Never`) for the same
> pattern in action.

---

## Read these before you write anything

### From the Codex repo (`repos/codex/`, read-only reference material)

| Path                                          | Why you're reading it                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex-rs/protocol/src/protocol.rs:983-1031`  | The canonical `SandboxPolicy` enum. **This is what you mirror in TypeScript.** Note: the backlog cites `sandboxing/src/lib.rs`, but the enum actually lives in `protocol.rs` — `sandboxing/src/lib.rs` only re-exports types from `manager.rs`.                               |
| `codex-rs/sandboxing/src/manager.rs:131-261`  | `SandboxManager::transform`. The shape of the call site: a struct of "command + cwd + env + permissions" gets transformed into a different command. You're building the TypeScript equivalent of the **input** to `transform`, plus the `SandboxType::None` arm of the match. |
| `codex-rs/sandboxing/src/manager.rs:22-39`    | `SandboxType` enum. Tells you what variants the seam needs to support eventually. For this story, only `None` matters.                                                                                                                                                        |
| `codex-rs/sandboxing/src/seatbelt.rs:602-741` | Skim only. `create_seatbelt_command_args` is what story 2 will port. You do **not** call this in story 1 — but glancing at it tells you why the seam has the shape it does (it transforms `argv` + env + cwd into a wrapped argv).                                            |

Don't get distracted by `landlock.rs`, `bwrap.rs`, or the `.sbpl` files. Those
are story-2/story-3 territory. If you start reading them you will lose the
afternoon.

### From this repo

| Path                                                                           | Why you're reading it                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/services/approval-policy.ts`](../../../src/services/approval-policy.ts)  | **Read this twice.** This is the template you are copying. Same shape: a `Context.Tag`, a service interface, multiple `Layer` values (auto / interactive / deny). Your `Sandbox` service will have exactly this structure with `SandboxNoopLayer` playing the role of `ApprovalAutoApproveLayer`. |
| [`src/services/plan-store.ts`](../../../src/services/plan-store.ts)            | Shorter example of the same pattern, but with `Ref` state inside the layer. You don't need state — just structure — so use `approval-policy.ts` as the primary template.                                                                                                                          |
| [`src/tools/bash.ts`](../../../src/tools/bash.ts)                              | The handler you are modifying. Specifically lines 79-139 (`bashHandler`). The `Command.make(...)` → `Command.start(cmd)` block is the bit you're routing through `Sandbox.run`.                                                                                                                   |
| [`src/toolkit.ts:35-51`](../../../src/toolkit.ts)                              | The "context capture" trick used by `HarnessToolkitLayerBare`. You need to add `Sandbox` to the captured context tuple.                                                                                                                                                                           |
| [`docs/architecture.md`](../../architecture.md)                                | The three-layer model. Make sure you can name `Tool` / `Toolkit` / `LanguageModel` before you change `bash.ts` — every change touches the boundary between layer 1 (Tool) and the dependency context that handlers run in.                                                                        |
| [`docs/patterns/effect-ai-gotchas.md`](../../patterns/effect-ai-gotchas.md) §2 | "Scope credential-requiring layers to the handler, not `MainLive`." The `Sandbox` layer is _not_ credential-requiring, so it can live at the bare-toolkit level — but the reasoning in §2 is the principle you're applying when deciding _where_ to provide it.                                   |

### From the `@effect/*` source (`repos/effect/`)

Treat these as the source of truth for API shapes. Don't guess — read.

| Path                                                                                 | Why                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repos/effect/packages/effect/src/Context.ts` (search for `Tag`)                     | How `Context.Tag` is declared. The class-extends-Tag idiom in `approval-policy.ts:16-19` is the canonical form.                                                                                                                             |
| `repos/effect/packages/effect/src/Layer.ts` (search for `succeed`)                   | Difference between `Layer.succeed`, `Layer.effect`, `Layer.scoped`. You want `Layer.succeed` here (no setup effect, no resources).                                                                                                          |
| `repos/effect/packages/platform/src/Command.ts`                                      | The `Command.make` / `Command.env` / `Command.workingDirectory` / `Command.start` API. The no-op layer's body will be a small wrapper around exactly these calls — see how `bashHandler` uses them today, around `src/tools/bash.ts:90-97`. |
| `repos/effect/packages/effect/src/Schema.ts` (search for `TaggedStruct` and `Union`) | How `Schema.Union` of `Schema.TaggedStruct`s decodes a `{ type: "..." }` JSON object. This is what you'll use to mirror Codex's `#[serde(tag = "type", rename_all = "kebab-case")]`.                                                        |

---

## The deliverable, shape-first

### File 1: `src/services/sandbox.ts`

```ts
import { Command } from "@effect/platform";
import type { CommandExecutor } from "@effect/platform/CommandExecutor";
import type { PlatformError } from "@effect/platform/Error";
import type { Process } from "@effect/platform/CommandExecutor";
import { Context, Effect, Layer, Schema } from "effect";

// Mirrors codex-rs/protocol/src/protocol.rs:983 — `SandboxPolicy`.
// Tagged with "type" + kebab-case strings so a Codex-style JSON config decodes
// the same way in both runtimes.

export const ReadOnly = Schema.TaggedStruct("read-only", {
  networkAccess: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});

export const WorkspaceWrite = Schema.TaggedStruct("workspace-write", {
  writableRoots: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => [],
  }),
  networkAccess: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});

export const DangerFullAccess = Schema.TaggedStruct("danger-full-access", {});

export const SandboxPolicy = Schema.Union(ReadOnly, WorkspaceWrite, DangerFullAccess);
export type SandboxPolicy = typeof SandboxPolicy.Type;

// What every backend (no-op, Seatbelt, Landlock) must offer.
//
// Why pass the assembled `Command.Command` instead of a raw string? Because
// the current `bashHandler` already builds a `Command` with env + cwd applied,
// and we want a backend like Seatbelt to be able to wrap (prepend
// `/usr/bin/sandbox-exec -p <profile> --`) the existing command without
// reaching into bashHandler's internals.

export interface SandboxService {
  readonly run: (
    command: Command.Command,
    policy: SandboxPolicy,
  ) => Effect.Effect<Process.Process, PlatformError, CommandExecutor>;
}

export class Sandbox extends Context.Tag("Sandbox")<Sandbox, SandboxService>() {}

// Default backend: no wrapping, no restrictions. Behaviour is identical to
// today's bashHandler. Story 2 (macOS Seatbelt) and story 3 (Linux Landlock)
// will add real implementations behind the same interface.

export const SandboxNoopLayer = Layer.succeed(Sandbox, {
  run: (command) => Command.start(command),
});
```

### File 2: changes to `src/tools/bash.ts`

In `bashHandler`, replace the line that calls `Command.start(cmd)` directly:

```ts
// before
const process = yield * Command.start(cmd);

// after
const sandbox = yield * Sandbox;
const process = yield * sandbox.run(cmd, { _tag: "danger-full-access" });
```

Add `Sandbox` to the imports and to the handler's `R` channel:

```ts
export const bashHandler = ({...}: BashParams): Effect.Effect<
  BashResult,
  BashError,
  CommandExecutor | ApprovalPolicy | Sandbox   // <- add Sandbox
> => /* ... */;
```

> **Why `danger-full-access` for now?** We're passing the policy through the
> seam but not enforcing it — the no-op layer ignores its second argument. The
> CLI flag that lets the user _choose_ a policy is story 4. Until then,
> hardcoding the most permissive variant matches today's behaviour and makes
> it obvious where the wiring will plug in later.

### File 3: changes to `src/toolkit.ts`

Extend the `Effect.context<...>` tuple in `HarnessToolkitLayerBare`:

```ts
const context =
  yield *
  Effect.context<FileSystem.FileSystem | ApprovalPolicy | PlanStore | CommandExecutor | Sandbox>();
```

Add `SandboxNoopLayer` to the self-contained `HarnessToolkitLayer`:

```ts
export const HarnessToolkitLayer = HarnessToolkitLayerBare.pipe(
  Layer.provide(ApprovalAutoApproveLayer),
  Layer.provide(PlanStoreLayer),
  Layer.provide(SandboxNoopLayer), // <- new
  Layer.provide(NodeContext.layer),
);
```

### File 4: changes to `src/cli.ts`

Inside `runCommand`'s `.pipe(...)`, add `Effect.provide(SandboxNoopLayer)` next
to the existing service providers. Position doesn't matter functionally (the
bare-toolkit layer is what consumes it), but keep it grouped with
`PlanStoreLayer` for readability.

### File 5: `test/services/sandbox.test.ts` (new)

Two assertions:

1. The no-op layer can run a real `echo` command and return a `Process` whose
   exit code resolves to `0`. Provide `NodeContext.layer` alongside
   `SandboxNoopLayer`.
2. `SandboxPolicy` decodes the three variants from their kebab-case JSON form,
   round-tripping cleanly. Use `Schema.decodeUnknownSync(SandboxPolicy)` and
   assert `_tag` on the result. Add one failing case for an unknown `type` to
   prove the union really rejects.

### File 6: changes to `test/tools/bash.test.ts`

Every `it.effect(...)` currently chains:

```ts
.pipe(Effect.provide(ApprovalAutoApproveLayer), Effect.provide(NodeContext.layer))
```

Add `SandboxNoopLayer` to each, between the approval layer and
`NodeContext.layer`:

```ts
.pipe(
  Effect.provide(ApprovalAutoApproveLayer),
  Effect.provide(SandboxNoopLayer),
  Effect.provide(NodeContext.layer),
)
```

That should be the only change to existing tests. If anything else needs
touching, you're probably introducing scope creep — push back to this story
spec.

---

## Step-by-step plan

Do them in this order. Each step is verifiable in isolation.

1. **Read the four "Codex repo" links above** plus `approval-policy.ts`. You
   should be able to answer "what is the `_tag` literal on each variant?" and
   "where does today's `bashHandler` actually spawn the process?" without
   re-opening the files.
2. **Create `src/services/sandbox.ts`** with the `SandboxPolicy` schema and
   the `Sandbox` tag, but stub the layer body with `Effect.die("not yet")`.
   Run `bun run typecheck`. It should be green — nothing consumes the service
   yet.
3. **Write the `SandboxPolicy` decode tests** in `test/services/sandbox.test.ts`.
   These don't depend on the layer body. Run `bun run test test/services/sandbox.test.ts`
   to confirm they pass.
4. **Fill in `SandboxNoopLayer`** with the `Command.start` delegation. Add the
   second test (the `echo` round-trip). Confirm `bun run test test/services/sandbox.test.ts`
   is green.
5. **Wire `Sandbox` into `bashHandler`.** Update its `R` channel. Run
   `bun run typecheck` — you'll see new errors in `toolkit.ts` and the tests
   complaining that `Sandbox` isn't provided. Good — that's the seam working.
6. **Update `toolkit.ts`** to capture and provide `Sandbox`. Typecheck again;
   the toolkit errors should be gone, leaving only test errors.
7. **Update `test/tools/bash.test.ts`** to provide `SandboxNoopLayer`. Then
   run `bun run test test/tools/bash.test.ts`. Every existing assertion must
   still pass — no behavioural change.
8. **Update `src/cli.ts`.** Run `bun src/cli.ts --help` and confirm it still
   prints help with no `ANTHROPIC_API_KEY` set (this is the §2 gotcha at work
   — your provider scoping must not have regressed).
9. **Run `bun run check`** for the full pipeline. Fix any lint/format nits.
10. **Re-read your diff.** Anything that touches Seatbelt, the CLI `--sandbox`
    flag, or a config file is out of scope — delete it. The diff should be
    small: one new file, one new test file, ~5-10 lines changed across four
    existing files.

---

## Testing approach

Follow [`docs/guides/testing.md`](../../guides/testing.md) exactly. Two notes
specific to this story:

- The new `test/services/sandbox.test.ts` is a **handler-direct-style** test:
  no `LanguageModel`, no `withLanguageModel`. Just call the service through
  its layer and assert.
- You do **not** need a new toolkit-via-mock test. The existing
  `test/toolkit.test.ts` already exercises `bash` end-to-end; once
  `HarnessToolkitLayer` provides `SandboxNoopLayer`, that test will route
  through your new code automatically. If it still passes unchanged, the
  wiring is correct.

For the `echo` round-trip test, mirror the live-clock pattern at the bottom
of `test/tools/bash.test.ts`: a real subprocess is started, so just use
`it.effect` with `NodeContext.layer`. No `TestClock`. See
[`docs/guides/testing.md` "Why the bash timeout test uses `it.live`"](../../guides/testing.md#why-the-bash-timeout-test-uses-itlive-not-testclock)
for the underlying reasoning.

---

## Validation checklist (before opening the PR)

Run each and paste the output (or a one-line confirmation) into your PR
description:

```bash
bun run typecheck                       # no errors
bun run lint                            # no errors
bun run format:check                    # no diff
bun run test                            # all green; new sandbox test visible
bun src/cli.ts --help                   # prints help WITHOUT requiring ANTHROPIC_API_KEY
```

Optional smoke test (requires the API key):

```bash
ANTHROPIC_API_KEY=... bun src/cli.ts run "echo hello via bash"
```

Should behave identically to before this change.

---

## Out of scope (do NOT do these here)

- Implementing Seatbelt (`sandbox-exec -p …`) — that's **Epic 1, story 2**.
- Implementing Landlock / bwrap — that's **Epic 1, story 3**.
- Adding a `--sandbox` CLI flag — that's **Epic 1, story 4**.
- Reading sandbox policy from a config file.
- Network-policy enforcement, writable-root resolution, the
  `seatbelt_*.sbpl` policy files.
- Touching any of the non-bash tools (`write`, `edit`, `apply_patch` are
  filesystem-only and don't go through `Sandbox` — they are gated by
  `ApprovalPolicy`).
- Updating `docs/architecture.md` with a sandbox diagram. Worth doing
  eventually, but only once a _real_ backend exists; otherwise the diagram
  describes a no-op.

If you find yourself drawn to any of the above, write a note in the PR
description and stop — those should be their own PRs against their own
stories.

---

## Glossary (for first-time Effect readers)

- **`Context.Tag`** — a type-level handle for a service. The runtime uses it
  to look up which implementation has been provided. `class Foo extends Context.Tag("Foo")<Foo, FooService>() {}` is the canonical declaration.
- **`Layer`** — a recipe for constructing a service. Multiple layers can
  satisfy the same `Tag` (e.g. `SandboxNoopLayer` today, `SandboxSeatbeltLayer`
  tomorrow). The CLI picks one.
- **`Effect.provide(layer)`** — at the call site, supply a layer to satisfy
  one of the effect's required services (its `R` channel).
- **`Schema.TaggedStruct(tag, fields)`** — a struct with a literal `_tag`
  field. `Schema.Union` of several `TaggedStruct`s gives you a discriminated
  union that round-trips cleanly through JSON.
- **`failureMode: "return"`** — a `Tool.make` option that turns handler
  failures into structured tool results instead of crashing the turn. You're
  not adding any tools in this story, but you'll see the option in
  `bash.ts`; leave it alone. See
  [gotchas §1](../../patterns/effect-ai-gotchas.md#1-set-failuremode-return-on-every-fallible-tool).

---

## When you're done

Open a PR titled **"sandbox: introduce service skeleton with no-op default layer"**.
In the description, link this file. The reviewer's first question will be
"does this change observable behaviour?" — your answer should be "no, the
default layer delegates to `Command.start` exactly as before, and every
existing test passes unchanged."

Then close this story and pick up **story 2 (macOS Seatbelt backend)** or
hand it off.
