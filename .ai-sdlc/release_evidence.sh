#!/bin/sh
# Prove each release commit came through review and checks. James, 17 Oct 2026, via Grok Bot:
# GitHub Free has no branch protection for private repos; level-3 enforcement on Free is the
# guarded auto_merge rule plus a per-release evidence check.
#   release_evidence.sh <owner/repo> <sha> [--base <branch>]
# RELEASE_REQUIRED_CHECKS (comma-separated) defaults to the four AI-SDLC checks; an empty value or
# auto_merge's REQUIRED_CHECKS never replaces them.
# Exit 0 evidence OK, 1 hold (reason on stdout), 2 bad input or gh failure (error on stderr).
set -u
error() { echo "EVIDENCE ERROR: $*" >&2; exit 2; }
[ $# -eq 2 ] || [ $# -eq 4 ] || error "usage: release_evidence.sh <owner/repo> <sha> [--base <branch>]"
repo=$1 sha=$2 base=main
if [ $# -eq 4 ]; then
  [ "$3" = --base ] && [ -n "$4" ] || error "expected --base <branch>"
  base=$4
fi
case "$repo" in */*) ;; *) error "the repo must be owner/name" ;; esac
case "$repo" in *[!A-Za-z0-9._/-]*|/*|*/|*/*/*) error "the repo must be owner/name" ;; esac
case "$sha" in ""|*[!0123456789abcdef]*) error "the sha must be 40 lowercase hex characters" ;; esac
[ ${#sha} -eq 40 ] || error "the sha must be 40 lowercase hex characters"
hold() { echo "EVIDENCE HOLD $sha: $*"; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)
case "$base" in ""|-*|*[!A-Za-z0-9._/-]*) error "the base must be a branch name" ;; esac
# The base and sha are checked above (branch characters, hex), so they sit in the jq string as data.
selector='.[] | select(.merged_at != null and .base.ref == "'"$base"'" and .merge_commit_sha == "'"$sha"'") | [.number, .head.sha] | join(" ")'
rc=0
prs=$(gh api "repos/$repo/commits/$sha/pulls" --jq "$selector" 2>&1) || rc=$?
[ "$rc" -eq 0 ] || error "could not read the PRs for $sha: $prs"
# One line per matching PR; count before splitting fields so duplicate matches always hold.
count=$(printf '%s\n' "$prs" | awk 'NF { n++ } END { print n+0 }')
[ "$count" -eq 1 ] || hold "expected exactly one merged PR into $base with merge commit $sha; found $count"
set -f
set -- $prs
[ $# -eq 2 ] || error "invalid merged PR answer for $sha"
pr=$1 head=$2
case "$pr" in ""|*[!0123456789]*) error "invalid PR number for $sha" ;; esac
case "$head" in ""|*[!0123456789abcdef]*) error "invalid head for #$pr" ;; esac
[ ${#head} -eq 40 ] || error "invalid head for #$pr"
# Release baseline (owner decision, 25 Oct 2026; modules/enforcement.md, Release baseline). A checks
# hold passes only when every cause is a cancelled run and the sha has one entry
# `<sha> #<pr> <ci-run-id> cancelled` in docs/release-baseline.txt, read from the base branch on
# GitHub (never the checkout, so a PR cannot list itself), whose run is a green ci.yml push or
# dispatch run on the base at a commit that contains the sha. Anything else keeps the hold.
baseline() {
  reason=$1
  only=$(printf '%s' "${reason% no cloud CI PASS on this head}" | awk -v RS=';' '
    { sub(/^[ \t\n]+/, ""); sub(/[ \t\n]+$/, "") }
    $0 == "" { next }
    { n++ }
    $0 !~ /^'"'"'.*'"'"' is cancelled( \(workflow runs unreadable\))?$/ { bad = 1 }
    END { print (n > 0 && !bad) ? "yes" : "no" }')
  [ "$only" = yes ] || hold "$reason"
  # head_checks.sh stops at the first red run, before the cloud report; a cloud FAIL is red too.
  cloud=$(HEAD_CHECKS_CLOUD_ONLY=1 sh "$here/head_checks.sh" "$repo" "$pr" "$head" 2>&1) \
    || hold "$reason (release baseline: could not read the cloud CI reports: $cloud)"
  case "$cloud" in
    ""|PASS) ;;
    *) hold "$reason (release baseline: the latest cloud CI report on $head is $cloud)" ;;
  esac
  list=$(gh api "repos/$repo/contents/docs/release-baseline.txt?ref=$base" -H "Accept: application/vnd.github.raw" 2>/dev/null) \
    || hold "$reason"
  line=$(printf '%s\n' "$list" | awk -v sha="$sha" '$1 == sha { n++; l = $0 } END { if (n == 1) print l }')
  [ -n "$line" ] || hold "$reason"
  set -- $line
  [ $# -eq 4 ] && [ "$2" = "#$pr" ] && [ "$4" = cancelled ] \
    || hold "$reason (release baseline: the entry for $sha is not '$sha #$pr <ci-run-id> cancelled')"
  run=$3
  case "$run" in ""|*[!0123456789]*) hold "$reason (release baseline: invalid CI run id '$run')" ;; esac
  ci=$(gh api "repos/$repo/actions/runs/$run" --jq '[.path, .head_branch, .event, .status, (.conclusion // "none"), .head_sha] | join(" ")' 2>&1) \
    || hold "$reason (release baseline: could not read CI run $run)"
  set -- $ci
  [ $# -eq 6 ] && [ "$1" = .github/workflows/ci.yml ] && [ "$2" = "$base" ] && [ "$4 $5" = "completed success" ] \
    && { [ "$3" = push ] || [ "$3" = workflow_dispatch ]; } \
    || hold "$reason (release baseline: CI run $run is not a green ci.yml push or dispatch run on $base: $ci)"
  runhead=$6
  case "$runhead" in ""|*[!0123456789abcdef]*) hold "$reason (release baseline: invalid head for CI run $run)" ;; esac
  [ ${#runhead} -eq 40 ] || hold "$reason (release baseline: invalid head for CI run $run)"
  compare=$(gh api "repos/$repo/compare/$sha...$runhead" --jq '[.status, .behind_by] | join(" ")' 2>&1) \
    || hold "$reason (release baseline: could not compare $sha with $runhead)"
  case "$compare" in
    "ahead 0"|"identical 0") ;;
    *) hold "$reason (release baseline: CI run $run on $runhead does not contain $sha: $compare)" ;;
  esac
  echo "EVIDENCE OK $sha: #$pr head $head (release baseline: only cancelled runs; CI run $run on $runhead is green)"
  exit 0
}
rc=0
review=$(REVIEW_ON_HEAD_REQUIRE_PROVENANCE=1 sh "$here/review_on_head.sh" "$pr" "$head" --repo "$repo" 2>&1) || rc=$?
case $rc in
  0) ;;
  1) hold "no independent APPROVE names head $head of #$pr: $review" ;;
  *) error "review_on_head.sh exit $rc for #$pr: $review" ;;
esac
rc=0
# A cancelled run counts as unfinished here (#677): merges cancel leftover runs on purpose, and a
# cloud PASS on the head stands in for it; without one it holds.
checks=$(HEAD_CHECKS_CANCELLED_OPEN=1 REQUIRED_CHECKS="${RELEASE_REQUIRED_CHECKS:-checks / owner-decisions.md is append-only,checks / A fix leaves its failing test alone,checks / No credentials in the PR range,checks / product.yaml is valid and a published product has its baseline}" \
  sh "$here/head_checks.sh" "$repo" "$pr" "$head" 2>&1) || rc=$?
case $rc in
  0) ;;
  1) baseline "$checks" ;;
  *) error "head_checks.sh exit $rc for #$pr: $checks" ;;
esac
echo "EVIDENCE OK $sha: #$pr head $head"
exit 0
