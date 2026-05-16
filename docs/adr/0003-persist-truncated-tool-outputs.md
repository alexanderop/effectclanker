# Persist truncated Tool outputs to a per-session tmpdir

When a **Tool output** exceeds the 50 KB / 2000-line cap, the model-facing body
is truncated and the full original content is written to
`os.tmpdir()/effectclanker-<sessionId>/tool_<callId>`. The truncation hint
embedded in the body names that path so the model can `grep` it or `read` it
with `offset`/`limit` on a follow-up round — avoiding the cost of re-issuing
the original tool call with narrower params. The dir is created in the
harness's root `Scope` and removed via finalizer when the scope closes; no
background sweeper, no cross-session retention.

Per-session (vs per-user with retention, opencode's design at
`repos/opencode/packages/opencode/src/tool/truncate.ts:14`) because the saved
path is only useful while the surrounding **Tool result** lives in the
session's `Chat` history. `/clear` or session exit invalidates the path
everywhere it was referenced; a longer retention would be solving a problem
we don't have. The `Scope` finalizer pattern matches `withTmpDir` from
`packages/tools/test/utilities.ts` — same shape, harness-scoped instead of
test-scoped.

If the FS write fails (`ENOSPC`, permissions, dir disappears mid-flight), the
handler degrades to inline-only truncation: truncated content still goes to
the model, the hint omits the saved-file path. The original tool call
succeeded; persistence is a recovery aid, not a precondition. Aligns with
the `failureMode: "return"` philosophy at
`docs/patterns/effect-ai-gotchas.md` §1 — an incidental failure of a recovery
aid shouldn't abort the primary operation.

Considered and rejected: no persistence (pushes recovery cost onto
re-execution — expensive for large `read` results that turn into many
round-trips), per-user persistence with retention sweeper (solves
cross-session resume, which we don't have, per the deliberate scope of
ADR-0002).
