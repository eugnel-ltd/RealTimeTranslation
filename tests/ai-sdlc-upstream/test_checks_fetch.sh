#!/bin/sh
# Every PR fetch in .github/workflows/checks.yml must work on a self-hosted runner that kept
# refs/remotes/pr/head from an earlier PR. Each fetch line runs against a real origin with
# refs/pull/1/head, in a clone whose pr/head points at an unrelated commit (a non-fast-forward).
#   sh tests/test_checks_fetch.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
wf=$here/../.github/workflows/checks.yml
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail=0
check() { if [ "$3" -eq "$2" ]; then echo "ok   $1"; else echo "FAIL $1: expected $2, got $3"; fail=1; fi; }
g() { git -c user.email=t@example.com -c user.name=t "$@"; }

g init -q -b main "$tmp/origin"
g -C "$tmp/origin" commit -q --allow-empty -m base
g -C "$tmp/origin" switch -q -c pr1
g -C "$tmp/origin" commit -q --allow-empty -m pr1
g -C "$tmp/origin" update-ref refs/pull/1/head HEAD
g -C "$tmp/origin" switch -q main
g clone -q "$tmp/origin" "$tmp/runner"
# The ref left behind by an earlier PR: a commit that pr1 does not descend from.
g -C "$tmp/runner" commit -q --allow-empty -m "earlier PR"
stale=$(g -C "$tmp/runner" rev-parse HEAD)
g -C "$tmp/runner" reset -q --hard origin/main
want=$(g -C "$tmp/origin" rev-parse refs/pull/1/head)

lines=$(grep -E 'git fetch .*refs/pull/' "$wf" | sed 's/^ *//')
n=$(printf '%s\n' "$lines" | grep -c .)
[ "$n" -ge 3 ]; check "checks.yml has the PR fetch lines ($n)" 0 $?
printf '%s\n' "$lines" | while IFS= read -r line; do
  g -C "$tmp/runner" update-ref refs/remotes/pr/head "$stale"
  (cd "$tmp/runner" && BASE=main PR=1 bash -e -c "$line") >/dev/null 2>&1
  code=$?
  got=$(g -C "$tmp/runner" rev-parse refs/remotes/pr/head)
  if [ "$code" -eq 0 ] && [ "$got" = "$want" ]; then echo "ok   fetch replaces a stale pr/head: $line"
  else echo "FAIL fetch with a stale pr/head (exit $code): $line"; exit 1; fi
done || fail=1
exit $fail
