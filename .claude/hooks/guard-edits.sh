#!/bin/sh
# PreToolUse hook for Edit|Write|MultiEdit|NotebookEdit. Exit 2 blocks the edit and sends
# stderr to Claude. Needs jq. Adapt the test-path patterns to the repo's layout.
#
# Enforces three must-hold rules:
#   1. docs/owner-decisions.md is append-only and recorded with scripts/record_decision.sh,
#      never edited by an agent's editor tool.
#   2. On a fix/ branch, once the failing test is committed, test files are read-only.
#   3. No credential-shaped text enters the tree.
# Every decision is logged to .claude/gate.log (add it to .gitignore).
in=$(cat)
path=$(printf '%s' "$in" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
[ -n "$path" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
rel=${path#"${CLAUDE_PROJECT_DIR:-$PWD}"/}
mkdir -p .claude
log() { printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$1" "$rel" "$2" >> .claude/gate.log; }
block() { log block "$1"; echo "BLOCKED: $1" >&2; exit 2; }

# 1. Owner decisions: append with the script, never edit.
[ "$rel" = docs/owner-decisions.md ] &&
  block "docs/owner-decisions.md is append-only. Record a decision with scripts/record_decision.sh, quoting the owner. Never remove or reword an entry."

# 2. Fix task: the committed failing test is locked.
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
case "$branch" in fix/*)
  case "$rel" in tests/*|*/tests/*|*test_*.py|*_test.go|*.test.*|*.spec.*)
    git diff --quiet origin/main...HEAD -- 'tests/' ':(glob)**/test_*.py' \
      ':(glob)**/*_test.go' ':(glob)**/*.test.*' ':(glob)**/*.spec.*' 2>/dev/null ||
      block "fix task: the failing test is committed; fix the code, not the test. If the test is wrong, say so and stop." ;;
  esac ;;
esac

# 3. Credentials in the new content. A sample, not a complete scanner.
new=$(printf '%s' "$in" | jq -r '[.tool_input.content, .tool_input.new_string,
  (.tool_input.edits // [] | .[].new_string), .tool_input.new_source] | map(select(.)) | join("\n")')
printf '%s' "$new" | grep -Eq -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
  -e 'AKIA[0-9A-Z]{16}' -e 'gh[pousr]_[A-Za-z0-9]{36}' -e 'sk-[A-Za-z0-9_-]{20,}' \
  -e 'xox[abprs]-[A-Za-z0-9-]{10,}' \
  -e '(api[_-]?key|secret|token|password)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'[:space:]]{12,}' &&
  block "this edit adds what looks like a credential. Read it from the environment or the secret store instead."

log allow edit
exit 0
