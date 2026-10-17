#!/bin/sh
# Owner-decisions check: docs/owner-decisions.md only gains lines between the base and the head.
#
#   owner_decisions_check.sh <base-ref> [head-ref] [file]
#
# Compares the merge base of <base-ref> and <head-ref> (default HEAD) with the head, the way the
# PR diff does, and fails when any line of the file was removed or changed. A changed line is a
# removal plus an addition, so an edit fails too. Every removed line is reported; only the diff
# headers are skipped (the lines before the first hunk), never a content line, whatever it starts
# with.
#
#   exit 0  no line removed
#   exit 1  a line was removed or changed
#   exit 2  the inputs are wrong or git failed
set -u
base=${1:-}; head=${2:-HEAD}; file=${3:-docs/owner-decisions.md}
[ -n "$base" ] || { echo "usage: owner_decisions_check.sh <base-ref> [head-ref] [file]" >&2; exit 2; }
git rev-parse --verify --quiet "$base^{commit}" >/dev/null || { echo "OWNER-DECISIONS RECORD ERROR: unknown base '$base'" >&2; exit 2; }
git rev-parse --verify --quiet "$head^{commit}" >/dev/null || { echo "OWNER-DECISIONS RECORD ERROR: unknown head '$head'" >&2; exit 2; }

diff=$(git diff -U0 "$base...$head" -- "$file") || { echo "OWNER-DECISIONS RECORD ERROR: git diff failed" >&2; exit 2; }
# Inside a hunk, every line that starts with "-" is removed content. Before the first "@@" the
# "---" line is a header, so it is skipped by position, not by its text.
# A removed blank line prints as "  - " so that it still counts.
removed=$(printf '%s\n' "$diff" | awk '/^@@/ { hunk = 1; next } hunk && /^-/ { print "  - " substr($0, 2) }')
if [ -n "$removed" ]; then
  n=$(printf '%s\n' "$removed" | wc -l | tr -d ' ')
  echo "OWNER-DECISIONS FAIL: $file lost $n line(s). It is append-only; a decision changes only by a new entry."
  printf '%s\n' "$removed"
  exit 1
fi
echo "OWNER-DECISIONS OK: no line removed from $file"
exit 0
