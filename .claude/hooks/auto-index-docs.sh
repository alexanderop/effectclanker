#!/bin/bash
# auto-index-docs.sh — PostToolUse hook
# Regenerates docs/plans/index.md when files are added or removed under docs/plans/.
# Does NOT touch docs/index.md (curated wiki) or docs/principles.md (categorical, hand-maintained).
# Emits bare wikilinks — no LLM-generated descriptions.
#
# Fast path: if disk matches index, exit immediately. Most tool calls hit this.

# Consume hook input so the harness doesn't block on the pipe.
cat > /dev/null

set -euo pipefail

PLANS_DIR="${CLAUDE_PROJECT_DIR}/docs/plans"
PLANS_INDEX="${PLANS_DIR}/index.md"

[ -d "$PLANS_DIR" ] || exit 0
[ -f "$PLANS_INDEX" ] || exit 0

# Plan entries on disk:
#   - any overview.md inside a subdirectory of docs/plans/ (multi-file plans)
#   - any top-level .md file in docs/plans/ except index.md (single-file plans)
# Wikilink form (vault root resolution):
#   - multi-file: plans/<slug>/overview
#   - single-file: plans/<name>
plans_disk=$(
  {
    find "$PLANS_DIR" -mindepth 2 -maxdepth 2 -name 'overview.md' -type f \
      | sed "s|^${PLANS_DIR}/||; s|/overview\.md\$|/overview|; s|^|plans/|"
    find "$PLANS_DIR" -mindepth 1 -maxdepth 1 -name '*.md' -type f ! -name 'index.md' \
      | sed "s|^${PLANS_DIR}/||; s|\.md\$||; s|^|plans/|"
  } | sort -u
)

plans_indexed=$(sed -n 's/.*\[\[\([^]]*\)\]\].*/\1/p' "$PLANS_INDEX" | sort -u)

# Fast path: nothing changed.
[ "$plans_disk" = "$plans_indexed" ] && exit 0

# Drift detected — rebuild.
emit_links() {
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    echo "- [[$f]]"
  done
}

{
  echo "# Plans"
  echo ""
  if [ -z "$plans_disk" ]; then
    echo "Phased implementation plans, written by the \`/plan\` skill or by hand. Each entry below points at an overview file. Phase files live alongside."
  else
    echo "Phased implementation plans, written by the \`/plan\` skill or by hand."
    echo ""
    echo "$plans_disk" | emit_links
  fi
} > "$PLANS_INDEX"
