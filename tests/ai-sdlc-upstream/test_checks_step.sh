#!/bin/sh
# Probe the review-on-head step of .github/workflows/checks.yml the way GitHub runs it (`bash -e`),
# with a fake git, a fake check script and a fake gh: the status must be written on success, on a
# REQUEST CHANGES and on an error, and the step must exit with the check's code.
#   sh tests/test_checks_step.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
wf=$here/../.github/workflows/checks.yml
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail=0
check() { if [ "$3" -eq "$2" ]; then echo "ok   $1"; else echo "FAIL $1: expected $2, got $3"; fail=1; fi; }
command -v python3 >/dev/null || { echo "skip: python3 needed to read the workflow"; exit 0; }

python3 - "$wf" "$tmp/step.sh" "$tmp/resolve.sh" <<'EOF'
import sys, yaml
wf = yaml.safe_load(open(sys.argv[1]))
steps = wf["jobs"]["review-on-head"]["steps"]
run = [s for s in steps if "run" in s][0]["run"]
open(sys.argv[2], "w").write(run)
resolve = [s for s in wf["jobs"]["resolve"]["steps"] if s.get("id") == "pr"][0]["run"]
open(sys.argv[3], "w").write(resolve)
matches = [s for job in wf["jobs"].values() for s in job.get("steps", [])
           if s.get("name") == "Written by names a vendor (warning)"]
assert len(matches) == 1, "Written by names a vendor (warning) step missing from checks.yml"
written_by = matches[0]
assert written_by.get("if") == "github.event_name == 'pull_request_target' || github.event_name == 'pull_request'", "written-by warning must run only on pull requests"
assert written_by.get("continue-on-error") is True, "written-by warning must set continue-on-error: true"
assert 'git show "origin/$BASE:$SCRIPTS/written_by_check.py"' in (written_by.get("run") or ""), "written-by warning must fetch written_by_check.py with git show \"origin/$BASE:$SCRIPTS/written_by_check.py\""
EOF
check "written-by warning step wired (if, continue-on-error, base git show)" 0 $?

mkdir -p "$tmp/bin"
# git: fetch succeeds; show writes a script whose exit code is FAKE_CODE (or fails when FAKE_MISSING=1).
cat > "$tmp/bin/git" <<'EOF'
#!/bin/sh
case "$1" in
  fetch) exit 0 ;;
  show) [ "${FAKE_MISSING:-0}" = 1 ] && exit 128; printf 'echo "REVIEW-ON-HEAD fake result"; exit %s\n' "$FAKE_CODE"; exit 0 ;;
esac
exit 1
EOF
# gh: record every call; answer `pr view --jq .headRefOid|.headRefName` from FAKE_HEAD and FAKE_BRANCH.
cat > "$tmp/bin/gh" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$GH_LOG"
[ "${FAKE_GH_FAIL:-0}" = 1 ] && exit 1
case "$*" in
  *.headRefOid*) printf '%s\n' "${FAKE_HEAD-}" ;;
  *.headRefName*) printf '%s\n' "${FAKE_BRANCH-}" ;;
esac
exit 0
EOF
chmod +x "$tmp/bin/git" "$tmp/bin/gh"

run_step() { # FAKE_CODE -> exit code; the gh log goes to $tmp/gh.log
  : > "$tmp/gh.log"
  (cd "$tmp" && PATH="$tmp/bin:$PATH" FAKE_CODE=$1 GH_LOG=$tmp/gh.log RUNNER_TEMP=$tmp GH_TOKEN=x PR=1 \
    HEAD=0123456789abcdef0123456789abcdef01234567 BASE=main SCRIPTS=scripts GITHUB_REPOSITORY=o/r RUN_URL=http://run \
    bash -e "$tmp/step.sh" >/dev/null 2>&1)
}

run_step 0; check "approve: step exits 0" 0 $?
grep -q 'state=success' "$tmp/gh.log"; check "approve: status success written" 0 $?

run_step 1; check "request changes: step exits 1" 1 $?
grep -q 'state=failure' "$tmp/gh.log"; check "request changes: status failure still written under bash -e" 0 $?

run_step 2; check "record error: step exits 2" 2 $?
grep -q 'state=error' "$tmp/gh.log"; check "record error: status error written" 0 $?

: > "$tmp/gh.log"
(cd "$tmp" && PATH="$tmp/bin:$PATH" FAKE_MISSING=1 FAKE_CODE=0 GH_LOG=$tmp/gh.log RUNNER_TEMP=$tmp GH_TOKEN=x PR=1 \
  HEAD=0123456789abcdef0123456789abcdef01234567 BASE=main SCRIPTS=scripts GITHUB_REPOSITORY=o/r RUN_URL=http://run \
  bash -e "$tmp/step.sh" >/dev/null 2>&1); check "script missing on base: step exits 2" 2 $?
grep -q 'state=error' "$tmp/gh.log"; check "script missing on base: status error written" 0 $?

: > "$tmp/gh.log"
(cd "$tmp" && PATH="$tmp/bin:$PATH" FAKE_GH_FAIL=1 FAKE_CODE=0 GH_LOG=$tmp/gh.log RUNNER_TEMP=$tmp GH_TOKEN=x PR=1 \
  HEAD=0123456789abcdef0123456789abcdef01234567 BASE=main SCRIPTS=scripts GITHUB_REPOSITORY=o/r RUN_URL=http://run \
  bash -e "$tmp/step.sh" >/dev/null 2>&1); check "status write fails on an approve: step exits 2, not 0" 2 $?

grep -q 'statuses/0123456789abcdef0123456789abcdef01234567' "$tmp/gh.log"; check "the status targets the resolved head sha" 0 $?
grep -q 'context=ai-sdlc/review-on-head' "$tmp/gh.log"; check "the status context is ai-sdlc/review-on-head" 0 $?

# The resolve step on a self-hosted runner: gh only, no external jq on the PATH, a validated head.
sha=0123456789abcdef0123456789abcdef01234567
bash_bin=$(command -v bash)   # the PATH below holds only the fake gh
run_resolve() { # EVENT IS_ISSUE_PR -> exit code; outputs in $tmp/out
  : > "$tmp/gh.log"; : > "$tmp/out"
  (cd "$tmp" && PATH="$tmp/bin" GH_LOG=$tmp/gh.log GITHUB_OUTPUT=$tmp/out GITHUB_REPOSITORY=o/r GH_TOKEN=x \
    EVENT=$1 IS_ISSUE_PR=$2 ISSUE_NUMBER=7 PR_NUMBER=7 PR_HEAD=$sha PR_BRANCH=topic \
    "$bash_bin" -e "$tmp/resolve.sh" >/dev/null 2>&1)
}
mkdir -p "$tmp/nobin"
FAKE_HEAD=$sha FAKE_BRANCH=topic run_resolve issue_comment true; check "resolve (comment): exits 0 without jq on the PATH" 0 $?
grep -qx "head=$sha" "$tmp/out"; check "resolve (comment): the head output is the PR head" 0 $?
grep -qx "branch=topic" "$tmp/out"; check "resolve (comment): the branch output is the PR branch" 0 $?
grep -q 'jq' "$tmp/gh.log"; check "resolve (comment): the head comes from gh's own --jq" 0 $?
FAKE_HEAD= FAKE_BRANCH=topic run_resolve issue_comment true; check "resolve (comment): an empty head fails the job (exit 2)" 2 $?
grep -q '^head=' "$tmp/out"; check "resolve (comment): no head output is written on failure" 1 $?
FAKE_HEAD=0123456789ab FAKE_BRANCH=topic run_resolve issue_comment true; check "resolve (comment): a short head fails the job (exit 2)" 2 $?
FAKE_HEAD=$sha FAKE_BRANCH= run_resolve issue_comment true; check "resolve (comment): an empty branch fails the job (exit 2)" 2 $?
run_resolve pull_request_target x; check "resolve (pull_request_target): exits 0" 0 $?
grep -qx "head=$sha" "$tmp/out"; check "resolve (pull_request_target): the head output is the event's head" 0 $?
run_resolve issue_comment false; check "resolve (comment on an issue): exits 0" 0 $?
grep -qx "is_pr=false" "$tmp/out"; check "resolve (comment on an issue): is_pr=false" 0 $?
(cd "$tmp" && PATH="$tmp/nobin" GITHUB_OUTPUT=$tmp/out GITHUB_REPOSITORY=o/r EVENT=issue_comment IS_ISSUE_PR=true ISSUE_NUMBER=7 \
  PR_NUMBER= PR_HEAD= PR_BRANCH= "$bash_bin" -e "$tmp/resolve.sh" >/dev/null 2>&1); check "resolve: no gh on the runner exits 2" 2 $?

exit $fail
