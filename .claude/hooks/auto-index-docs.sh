#!/bin/bash
# auto-index-docs.sh — PostToolUse hook
# Regenerates docs/index.md when docs/ files are added or removed.
# Emits bare wikilinks — no LLM-generated descriptions.

# Consume hook input
cat > /dev/null

set -euo pipefail

DOCS_DIR="${CLAUDE_PROJECT_DIR}/docs"
INDEX="${DOCS_DIR}/index.md"

[ -d "$DOCS_DIR" ] || exit 0
[ -f "$INDEX" ] || exit 0

# All .md files except any index.md — relative paths without .md extension
disk=$(find "$DOCS_DIR" -name "*.md" ! -name "index.md" -type f \
    | sed "s|^${DOCS_DIR}/||; s|\.md$||" \
    | sort)

# Wikilinks in current index
indexed=$(sed -n 's/.*\[\[\([^]]*\)\]\].*/\1/p' "$INDEX" | sort)

# Exit fast if nothing changed (no new/removed files)
[ "$disk" = "$indexed" ] && exit 0

# --- Drift detected, rebuild ---

# Emit a list of bare wikilinks
emit_files() {
    while IFS= read -r f; do
        [ -z "$f" ] && continue
        echo "- [[$f]]"
    done
}

# Collect all top-level directories
dirs=$(echo "$disk" | grep '/' | sed 's|/.*||' | sort -u)

# Rebuild index
{
    echo "# Docs"
    for section in $dirs; do
        files=$(echo "$disk" | grep "^${section}\(/\|$\)" || true)
        [ -z "$files" ] && continue
        # Capitalize first letter for header (portable: GNU sed's \U is non-POSIX)
        header="$(echo "$section" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')"
        printf '\n## %s\n' "$header"
        echo "$files" | emit_files
    done

    # Standalone files (not in any subdirectory and not already grouped under a section)
    standalone=$(echo "$disk" | grep -v '/' | while IFS= read -r f; do
        [ -z "$f" ] && continue
        # Skip if matches an existing top-level directory name
        if echo "$dirs" | grep -qx "$f"; then
            continue
        fi
        echo "$f"
    done)
    if [ -n "$standalone" ]; then
        printf '\n## Other\n'
        echo "$standalone" | emit_files
    fi
    echo ""
} > "$INDEX"
