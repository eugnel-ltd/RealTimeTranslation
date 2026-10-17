#!/bin/sh
# PreToolUse hook for Bash: the plan-divergence gate. Exit 2 blocks the command and sends stderr
# to Claude. Needs jq and git.
#
# Rule (SKILL.md §3 step 4, templates/plan.md): a commit that changes a file the plan does not
# name must update the plan's Divergences section in the same commit.
#   - Acts only on a `git commit` command; every other command passes.
#   - The plan is docs/plans/<issue>.md, the issue taken from the branch name <type>/<issue>-<slug>.
#     No issue number in the branch, or no plan file: the commit passes (trivial and doc-only work).
#   - The plan names files as "- `<path>`" lines under "## Files that change". An entry ending in
#     "/" covers everything under it; an entry may be a shell glob ("src/*.py").
#   - The commit's files are the staged ones, plus the tracked changes when the command holds -a,
#     --all or a short flag group with a (-am) anywhere: a superset only makes the gate stricter.
#   - The plan's Divergences count only when the plan's change is already staged (index copy).
#   - The hook runs before the command. When the same command also stages (git add, rm, mv or
#     stage), it cannot know what will be staged: it passes only when every change in the tree,
#     untracked files included, is inside the plan; else it asks to stage and commit separately.
#     A commit with pathspecs is not inspected beyond that; review criterion 8 is the backstop.
# Every decision is logged to .claude/gate.log.
cmd=$(jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0
printf '%s\n' "$cmd" | grep -Eq '(^|[;&|(][[:space:]]*|[[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+commit([[:space:]]|$)' || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
set -f # plan entries are patterns for case, never expanded against the tree

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
issue=$(printf '%s\n' "$branch" | sed -n 's|^[A-Za-z0-9_.-]*/\([0-9][0-9]*\)\([-_].*\)\{0,1\}$|\1|p')
[ -n "$issue" ] || exit 0
plan=docs/plans/$issue.md
stages=0
printf '%s\n' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+(add|rm|mv|stage)([[:space:]]|$)' && stages=1
# For the files, any "-a" in the command counts: a superset only makes the gate stricter.
any_a=0
printf '%s\n' "$cmd" | grep -Eq '[[:space:]](-a|--all|-[A-Za-z]*a[A-Za-z]*)([[:space:]]|$)' && any_a=1
# The plan's Divergences count only from the index: the hook never guesses what a command will
# stage. An edit to the plan that is not staged yet does not excuse a file; stage the plan first.
if git cat-file -e ":$plan" 2>/dev/null; then plan_text=$(git show ":$plan")
elif [ -f "$plan" ]; then plan_text=$(cat "$plan")
else exit 0
fi

mkdir -p .claude
log() { printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$1" "$plan" "$2" >> .claude/gate.log; }

files=$(git diff --cached --name-only 2>/dev/null)
if [ "$any_a" = 1 ]; then
  files=$(printf '%s\n%s\n' "$files" "$(git diff --name-only 2>/dev/null)")
fi
if [ "$stages" = 1 ]; then
  files=$(printf '%s\n%s\n%s\n' "$files" "$(git diff --name-only 2>/dev/null)" "$(git ls-files --others --exclude-standard 2>/dev/null)")
fi
files=$(printf '%s\n' "$files" | sed '/^$/d' | sort -u)
[ -n "$files" ] || exit 0

# The paths the plan names.
named=$(printf '%s\n' "$plan_text" | awk '
  /^## / { on = ($0 ~ /^## Files that change[[:space:]]*$/); next }
  on && /^[[:space:]]*[-*][[:space:]]+`/ { s = $0; sub(/^[^`]*`/, "", s); sub(/`.*/, "", s); if (s != "") print s }')

outside=""
for f in $files; do
  [ "$f" = "$plan" ] && continue
  hit=0
  for n in $named; do
    case "$n" in */) case "$f" in "$n"*) hit=1 ;; esac ;; esac
    # shellcheck disable=SC2254
    case "$f" in $n) hit=1 ;; esac
    [ $hit = 1 ] && break
  done
  [ $hit = 1 ] || outside="$outside $f"
done
[ -n "$outside" ] || { log allow "inside the plan"; exit 0; }

# Outside the plan: the same commit must change the plan's Divergences section.
section() { awk '/^## / { on = ($0 ~ /^## Divergences[[:space:]]*$/); next } on'; }
new_div=$(printf '%s\n' "$plan_text" | section)
old_div=$(git show "HEAD:$plan" 2>/dev/null | section)
staged_plan=0
git diff --cached --name-only 2>/dev/null | grep -qxF "$plan" && staged_plan=1
if [ "$stages" = 1 ]; then
  # Before the command runs, the hook cannot know which files its git add will stage, so it reads
  # the whole tree. That superset lies inside the plan (passed above) or the commit waits.
  log block "stages and commits in one command, tree outside the plan:$outside"
  echo "BLOCKED: $plan is in force and the tree has changes outside it:$outside. Stage first, then run git commit as a separate command, so the plan gate reads the exact files." >&2
  exit 2
fi
# commit -a would commit the working copy of the plan, not the index copy read above.
if [ "$any_a" = 1 ] && ! git diff --quiet -- "$plan" 2>/dev/null; then
  log block "commit -a with the plan's working copy unlike its index copy"
  echo "BLOCKED: $plan differs between the working tree and the index, and this commit may stage it again with -a. Stage the plan you mean (git add '"$plan"'), then commit." >&2
  exit 2
fi
if [ "$staged_plan" = 1 ] && [ "$new_div" != "$old_div" ]; then
  log allow "outside the plan, Divergences updated:$outside"; exit 0
fi
log block "outside the plan:$outside"
echo "BLOCKED: this commit changes files $plan does not name:$outside. Add them under '## Files that change', or log the divergence under '## Divergences' (date, what changed, why), and stage the plan (git add '"$plan"') before the commit." >&2
exit 2
