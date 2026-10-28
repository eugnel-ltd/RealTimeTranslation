#!/bin/sh
# Accept a held release commit once a later reviewed PR remediates it (#438). release_evidence.sh
# holds a first-parent commit X that skipped review or checks, and nothing could clear it. A later
# commit R of the same base can: its PR body says `- Remediates: <X>`, R itself passes
# release_evidence.sh, the independent APPROVE of R's head carries a visible `Remediates: <X>` line
# (review_on_head.sh --remediates), and X is an ancestor of R. The reviewer reads X's hold reason and
# writes the line only once the PR fixes each cause; no script matches the reason to the change.
#   release_remediation.sh <owner/repo> <held-sha> <later-sha>... [--base <branch>]
# The later shas are tried in the order given (a walker passes the newest first). The first one whose
# PR body carries the exact claim is checked fully; a failure there is a hold, never a fall-through
# to another later sha. A later sha with no claim is skipped.
# Exit 0 remediated (REMEDIATED <X> by <R>: #<pr> head <head> on stdout), 1 hold (reason on stdout),
# 2 bad input or gh failure (error on stderr).
set -u
error() { echo "REMEDIATION ERROR: $*" >&2; exit 2; }
usage="usage: release_remediation.sh <owner/repo> <held-sha> <later-sha>... [--base <branch>]"
[ $# -ge 3 ] || error "$usage"
repo=$1 held=$2
shift 2
base=main later=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base) [ $# -ge 2 ] && [ -n "$2" ] || error "expected --base <branch>"; base=$2; shift 2 ;;
    -*) error "$usage" ;;
    *) later="$later $1"; shift ;;
  esac
done
case "$repo" in */*) ;; *) error "the repo must be owner/name" ;; esac
case "$repo" in *[!A-Za-z0-9._/-]*|/*|*/|*/*/*) error "the repo must be owner/name" ;; esac
case "$base" in ""|-*|*[!A-Za-z0-9._/-]*) error "the base must be a branch name" ;; esac
valid_sha() {
  case "$1" in ""|*[!0123456789abcdef]*) return 1 ;; esac
  [ ${#1} -eq 40 ]
}
valid_sha "$held" || error "the held sha must be 40 lowercase hex characters"
[ -n "$later" ] || error "$usage"
set -f
for r in $later; do
  valid_sha "$r" || error "each later sha must be 40 lowercase hex characters"
done
hold() { echo "REMEDIATION HOLD $held: $*"; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)

# The base, the shas and the claim are checked above (branch characters, hex), so they sit in the jq
# string as data. One line per merged PR with this merge commit: number, head, whether the body holds
# the unit separator used below, then B and the body with its newlines turned into that separator
# (the B keeps `read`-style trimming from eating the first line's indentation).
for r in $later; do
  selector='.[] | select(.merged_at != null and .base.ref == "'"$base"'" and .merge_commit_sha == "'"$r"'") | [.number, .head.sha, ((.body // "") | contains("\u001f")), "B" + ((.body // "") | gsub("\r"; "") | gsub("\n"; "\u001f"))] | join(" ")'
  rc=0
  prs=$(gh api "repos/$repo/commits/$r/pulls" --jq "$selector" 2>&1) || rc=$?
  [ "$rc" -eq 0 ] || error "could not read the PRs for $r: $prs"
  rc=0
  count=$(printf '%s\n' "$prs" | awk 'NF { n++ } END { print n+0 }') || rc=$?
  [ "$rc" -eq 0 ] || error "could not count the PRs for $r (awk exit $rc)"
  case "$count" in ""|*[!0123456789]*) error "could not count the PRs for $r" ;; esac
  [ "$count" -le 1 ] || hold "expected exactly one merged PR into $base with merge commit $r; found $count"
  [ "$count" -eq 1 ] || continue
  pr=${prs%% *}; rest=${prs#* }
  head=${rest%% *}; rest=${rest#* }
  control=${rest%% *}; body=${rest#* }
  case "$pr" in ""|*[!0123456789]*) error "invalid PR number for $r" ;; esac
  case "$head" in ""|*[!0123456789abcdef]*) error "invalid head for #$pr" ;; esac
  [ ${#head} -eq 40 ] || error "invalid head for #$pr"
  case "$control" in true|false) ;; *) error "invalid PR answer for $r" ;; esac
  case "$body" in B*) ;; *) error "invalid PR answer for $r" ;; esac
  # A body that carries the separator itself could fake a line break: it names no claim.
  [ "$control" = false ] || continue
  rc=0
  # One awk reads the body from the environment and splits it on the separator itself, so there is
  # no pipe and a single status to check. It reads no input: only BEGIN runs.
  claimed=$(BODY=${body#B} awk -v want="- Remediates: $held" '
    function scan(l,   t, k, n, c, info, out, pos, rest, at) {
      vis = ""; vis_ok = 0
      if (fence_len > 0) {
        t = l; k = 0
        while (k < 3 && substr(t, 1, 1) == " ") { t = substr(t, 2); k++ }
        n = 0
        while (substr(t, n + 1, 1) == fence_ch) n++
        if (n >= fence_len && substr(t, n + 1) ~ /^[ \t]*$/) fence_len = 0
        return
      }
      if (!cmt) {
        if (l ~ /^(    |\t)/ || l ~ /^( |  |   )?>/) return
        t = l; k = 0
        while (k < 3 && substr(t, 1, 1) == " ") { t = substr(t, 2); k++ }
        c = substr(t, 1, 1)
        if (c == "`" || c == "~") {
          n = 0
          while (substr(t, n + 1, 1) == c) n++
          if (n >= 3) {
            info = substr(t, n + 1)
            if (c == "`" && index(info, "`") > 0) { amb = 1; return }
            fence_ch = c; fence_len = n
            return
          }
        }
      }
      out = ""; pos = 1
      while (pos <= length(l)) {
        rest = substr(l, pos)
        if (cmt) {
          at = index(rest, "-->")
          out = out " "
          if (at == 0) break
          pos += at + 2; cmt = 0
        } else {
          at = index(rest, "<!--")
          if (at == 0) { out = out rest; break }
          out = out substr(rest, 1, at - 1) " "
          pos += at + 3; cmt = 1
        }
      }
      vis = out; vis_ok = 1
    }
    BEGIN {
      n = split(ENVIRON["BODY"], lines, "\037")
      for (i = 1; i <= n; i++) { scan(lines[i]); if (vis_ok) { v = vis; sub(/ +$/, "", v); if (v == want) found = 1 } }
      print (found && !amb && !cmt && fence_len == 0) ? "yes" : "no"
    }') || rc=$?
  [ "$rc" -eq 0 ] || error "could not read the PR body of #$pr (awk exit $rc)"
  case "$claimed" in yes|no) ;; *) error "could not read the PR body of #$pr" ;; esac
  [ "$claimed" = yes ] || continue

  # The first R that names X: every step below must pass, or X holds.
  rc=0
  evidence=$(sh "$here/release_evidence.sh" "$repo" "$r" --base "$base" 2>&1) || rc=$?
  case $rc in
    0) ;;
    1) hold "$r names it in #$pr but has no release evidence: $evidence" ;;
    *) error "release_evidence.sh exit $rc for $r: $evidence" ;;
  esac
  rc=0
  review=$(REVIEW_ON_HEAD_REQUIRE_PROVENANCE=1 sh "$here/review_on_head.sh" "$pr" "$head" --repo "$repo" --remediates "$held" 2>&1) || rc=$?
  case $rc in
    0) ;;
    1) hold "no attested claim names it: the review of head $head of #$pr does not carry a visible Remediates line for it: $review" ;;
    *) error "review_on_head.sh exit $rc for #$pr: $review" ;;
  esac
  rc=0
  compare=$(gh api "repos/$repo/compare/$held...$r" --jq '[.status, .behind_by] | join(" ")' 2>&1) || rc=$?
  [ "$rc" -eq 0 ] || error "could not compare $held with $r: $compare"
  case "$compare" in
    "ahead 0") ;;
    *) hold "$held is not an ancestor of $r (GitHub's compare says: $compare)" ;;
  esac
  echo "REMEDIATED $held by $r: #$pr head $head"
  exit 0
done
hold "no attested claim names it"
