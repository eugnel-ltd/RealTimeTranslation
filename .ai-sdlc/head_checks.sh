#!/bin/sh
# The shared check-run and cloud CI rule for auto-merge and release evidence: a cloud PASS
# stands in for unfinished or missing runs on this head, never for a red run.
#   head_checks.sh <owner/repo> <pr> <head-sha>
# REVIEW_JOB defaults to the independent review job; REQUIRED_CHECKS is comma-separated (test).
# Exit 0 green (prints a cloud stand-in if used), 1 not green (reason), 2 bad input or gh failure.
set -u
fail() { echo "$*"; exit 2; }
hold() { echo "$*"; exit 1; }
[ $# -eq 3 ] || fail "usage: head_checks.sh <owner/repo> <pr> <head-sha>"
repo=$1 pr=$2 sha=$3
case "$repo" in */*) ;; *) fail "the repo must be owner/name" ;; esac
case "$repo" in *[!A-Za-z0-9._/-]*|/*|*/|*/*/*) fail "the repo must be owner/name" ;; esac
case "$pr" in ""|*[!0123456789]*) fail "the PR must be numeric" ;; esac
case "$sha" in ""|*[!0123456789abcdef]*) fail "the sha must be 40 lowercase hex characters" ;; esac
[ ${#sha} -eq 40 ] || fail "the sha must be 40 lowercase hex characters"
review_job=${REVIEW_JOB:-checks / Independent APPROVE names the head}
required=${REQUIRED_CHECKS:-test}

# The latest cloud CI report on head $1 of PR $2: PASS, FAIL, or nothing. A report is a comment
# whose author_association is OWNER, MEMBER or COLLABORATOR (checked before reading its body),
# whose first non-blank line is exactly `CLOUD-CI: PASS` or `CLOUD-CI: FAIL` and whose second is
# exactly `Tested head: <the full 40-character head>`; nothing else in a comment is read.
cloud_ci() {
  # REST, not `gh pr view`: Claude Code cloud sessions refuse GraphQL.
  bodies=$(gh api --paginate "repos/$repo/issues/$2/comments?per_page=100" --jq '.[] | select(.author_association == "OWNER" or .author_association == "MEMBER" or .author_association == "COLLABORATOR") | .body + "\u001e"' && printf x) || return 1
  printf '%s' "${bodies%x}" | HEAD_SHA="$1" awk 'BEGIN { RS = "\036"; FS = "\n" }
    {
      v = ""; n = 0
      for (i = 1; i <= NF && n < 2; i++) {
        line = $i; sub(/\r$/, "", line)
        if (line ~ /^[[:space:]]*$/) continue
        n++
        if (n == 1) {
          if (line !~ /^CLOUD-CI: (PASS|FAIL)[ \t]*$/) break
          v = (line ~ /PASS/) ? "PASS" : "FAIL"
        } else if (line ~ /^Tested head:[ \t]*`?[0-9a-f]+`?[ \t]*$/) {
          h = line; sub(/^Tested head:[ \t]*`?/, "", h); sub(/`?[ \t]*$/, "", h)
          if (h == ENVIRON["HEAD_SHA"]) last = v
        }
      }
    }
    END { print last }'
}

runs=$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100" \
  --jq 'if .total_count > (.check_runs | length) then "\u001ftoo-many" else (.check_runs | group_by(.name) | map(max_by(.id)) | .[] | [.name, .status, (.conclusion // "none")] | join("\u001f")) end') \
  || fail "could not read the check runs of $sha"
# bad: a run that finished red (nothing stands in for it); open: a run that has not finished or
# a required run that is not there (a cloud CI PASS on this head stands in for these).
bad="" open=""
seen=""
us=$(printf '\037')
while IFS="$us" read -r name status conclusion; do
  if [ -z "$name" ]; then
    [ "$status" = too-many ] && bad="$bad more than 100 check runs, not all read;"
    continue
  fi
  seen="$seen$name$us"
  [ "$name" = "$review_job" ] && continue
  if [ "$status" != completed ]; then open="$open '$name' is $status;"; continue; fi
  case "$conclusion" in success|skipped|neutral) ;; *) bad="$bad '$name' is $conclusion;" ;; esac
done <<EOF
$runs
EOF
old_ifs=$IFS; IFS=,
for want in $required; do
  case "$us$seen" in *"$us$want$us"*) ;; *) open="$open '$want' has not run;" ;; esac
done
IFS=$old_ifs
[ -z "$bad" ] || hold "$bad$open"
cloud=$(cloud_ci "$sha" "$pr") || fail "could not read the comments of #$pr"
[ "$cloud" != FAIL ] || hold "the latest cloud CI report on $sha is a FAIL"
if [ -n "$open" ]; then
  [ "$cloud" = PASS ] || hold "$open no cloud CI PASS on this head"
  echo "the cloud CI PASS on $sha stands in for:$open"
fi
exit 0
