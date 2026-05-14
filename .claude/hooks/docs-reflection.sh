#!/usr/bin/env bash
# Stop hook: after a "bigger" task (heuristic: >= TOOL_THRESHOLD tool-use events
# in the transcript), prompt Claude to reflect on whether anything from the
# conversation is worth adding to or updating in docs/.
#
# Mechanism: emit {"decision":"block","reason":"..."} on stdout. That prevents
# Claude from stopping and continues the conversation with the `reason` as the
# next instruction. Loop guard: if the payload's `stop_hook_active` is true,
# we're already inside a continuation — exit 0 so Claude can actually stop.
#
# Docs reference:
#   https://code.claude.com/docs/en/hooks  (Stop event, decision: "block")
#   https://code.claude.com/docs/en/hooks-guide  ("Stop hook runs forever" -> stop_hook_active)

set -euo pipefail

TOOL_THRESHOLD=5

input="$(cat)"

# Bail if jq is missing — fail open (allow stop) rather than block.
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

stop_hook_active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false')"
if [ "$stop_hook_active" = "true" ]; then
  exit 0
fi

transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // empty')"
if [ -z "$transcript_path" ] || [ ! -f "$transcript_path" ]; then
  exit 0
fi

# Heuristic for "bigger task". The transcript is JSONL; tool calls appear as
# blocks with "type":"tool_use". Count them across the whole session.
tool_use_count="$(grep -c '"type":"tool_use"' "$transcript_path" 2>/dev/null || true)"
tool_use_count="${tool_use_count:-0}"
if [ "$tool_use_count" -lt "$TOOL_THRESHOLD" ]; then
  exit 0
fi

# Grace period: give the user 15s to follow up before reflection kicks in.
sleep 15

# Single-line JSON so shell quoting stays sane. Newlines in `reason` are
# encoded as literal \n which Claude renders correctly.
cat <<'JSON'
{"decision":"block","reason":"Before stopping: look back at this turn's work. Is anything from this conversation worth adding to or updating in docs/ (docs/index.md, docs/architecture.md, docs/guides/*, docs/patterns/*)?\n\nBe selective. Worth capturing: non-obvious decisions, gotchas that cost real debugging time, conventions that future-you wouldn't infer from the code, references to canonical sources in repos/.\n\nNot worth capturing: routine bug fixes, mechanical refactors, anything already obvious from a glance at the code, conversational filler.\n\nIf yes — propose a concrete edit (which file, which section, what to add/change) and apply it. If no, reply 'docs are fine' in one line and stop."}
JSON
