#!/bin/sh
# PostToolUse hook for Edit|Write|MultiEdit: run the repo's own format and lint commands after
# each edit and report a lint failure to the agent (exit 2 sends stderr to Claude; the edit has
# already happened). Needs jq.
#
# The commands come from Commands in docs/code-standards.md, nowhere else:
#   - Format: `<command>`   run first; its failure is reported the same way
#   - Lint: `<command>`
# A line still holding the template placeholder (`<...>`), or no such line, means no command: the
# hook does nothing. In a command, {file} stands for the edited file's path (passed in a variable,
# never pasted into the command), so a repo can lint one file instead of the whole tree. The commands are the repo's own, as trusted as any
# script in it; the hook adds no tool.
# Every run is logged to .claude/gate.log.
in=$(cat)
path=$(printf '%s' "$in" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
[ -n "$path" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
[ -f docs/code-standards.md ] || exit 0
rel=${path#"${CLAUDE_PROJECT_DIR:-$PWD}"/}

# cmd_for <Name>: the command in "- <Name>: `<command>`" under ## Commands, or nothing.
cmd_for() {
  awk -v name="$1" '
    /^## / { on = ($0 ~ /^## Commands[[:space:]]*$/); next }
    on && index($0, "- " name ": `") == 1 {
      s = substr($0, length("- " name ": `") + 1); sub(/`.*/, "", s); print s; exit }' docs/code-standards.md
}

mkdir -p .claude
log() { printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$1" "$rel" "$2" >> .claude/gate.log; }

for name in Format Lint; do
  cmd=$(cmd_for "$name")
  case "$cmd" in ''|'<'*) continue ;; esac
  # {file} becomes a reference to the variable AI_SDLC_FILE, never the path's own text, so no file
  # name is ever read as shell code.
  # A placeholder the repo already quoted ("{file}" or '{file}') is taken as the bare one first.
  cmd=$(printf '%s\n' "$cmd" | sed "s|\"{file}\"|{file}|g; s|'{file}'|{file}|g" | sed 's|{file}|"$AI_SDLC_FILE"|g')
  if out=$(AI_SDLC_FILE=$rel sh -c "$cmd" 2>&1); then
    log allow "$name ok"
  else
    rc=$?
    log block "$name exit $rc"
    {
      echo "$name failed after editing $rel (exit $rc): $cmd"
      printf '%s\n' "$out" | tail -20
      echo "Fix it before you go on."
    } >&2
    exit 2
  fi
done
exit 0
