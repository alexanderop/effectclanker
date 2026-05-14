#!/bin/bash
# SessionStart hook: inject the docs/ wiki landing page so the agent sees
# what persistent knowledge is available before doing anything else.

set -euo pipefail

DOCS_INDEX="$CLAUDE_PROJECT_DIR/docs/index.md"
PRINCIPLES_INDEX="$CLAUDE_PROJECT_DIR/docs/principles.md"

if [ -f "$DOCS_INDEX" ]; then
  echo "docs/ wiki — read the relevant files before acting:"
  echo ""
  cat "$DOCS_INDEX"
fi

if [ -f "$PRINCIPLES_INDEX" ]; then
  echo ""
  echo "---"
  echo ""
  cat "$PRINCIPLES_INDEX"
fi
