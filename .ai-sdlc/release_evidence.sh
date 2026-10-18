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
rc=0
review=$(sh "$here/review_on_head.sh" "$pr" "$head" --repo "$repo" 2>&1) || rc=$?
case $rc in
  0) ;;
  1) hold "no independent APPROVE names head $head of #$pr" ;;
  *) error "review_on_head.sh exit $rc for #$pr: $review" ;;
esac
rc=0
checks=$(REQUIRED_CHECKS="${RELEASE_REQUIRED_CHECKS:-checks / owner-decisions.md is append-only,checks / A fix leaves its failing test alone,checks / No credentials in the PR range,checks / product.yaml is valid and a published product has its baseline}" \
  sh "$here/head_checks.sh" "$repo" "$pr" "$head" 2>&1) || rc=$?
case $rc in
  0) ;;
  1) hold "$checks" ;;
  *) error "head_checks.sh exit $rc for #$pr: $checks" ;;
esac
echo "EVIDENCE OK $sha: #$pr head $head"
exit 0
