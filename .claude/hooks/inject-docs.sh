#!/bin/bash
# SessionStart hook: inject the docs/ vault index so the agent sees
# what persistent knowledge is available before doing anything else.

set -euo pipefail

DOCS_INDEX="$CLAUDE_PROJECT_DIR/docs/index.md"

if [ -f "$DOCS_INDEX" ]; then
  echo "docs/ vault index — read the relevant files before acting:"
  echo ""
  cat "$DOCS_INDEX"
fi
