#!/bin/sh
# Prove release evidence from REST fixtures through the scripts' own jq expressions.
#   sh tests/test_release_evidence.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
script=$here/../scripts/release_evidence.sh
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail=0
check() { if [ "$3" -eq "$2" ]; then echo "ok   $1"; else echo "FAIL $1: expected $2, got $3"; fail=1; fi; }
has() { grep -qF "$2" "$tmp/$3"; check "$1" 0 $?; }
command -v jq >/dev/null || { echo "skip: jq needed for the fake gh"; exit 0; }
unset REVIEW_ON_HEAD_COMMENTS REQUIRED_CHECKS REVIEW_JOB
A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
mkdir -p "$tmp/bin" "$tmp/fix"
cat > "$tmp/bin/gh" <<'FAKE'
#!/bin/sh
[ "$1" = api ] || exit 1
[ "$2" = --paginate ] && shift
path=$2; expr=$4
case "$path" in
  */commits/*/pulls) [ "${PULLS_FAIL:-0}" = 1 ] && exit 1; f=pulls ;;
  */comments*) [ "${COMMENTS_FAIL:-0}" = 1 ] && exit 1; f=comments ;;
  */check-runs*) [ "${RUNS_FAIL:-0}" = 1 ] && exit 1; f=runs ;;
  *) exit 1 ;;
esac
exec jq -r "$expr" "$FIX/$f.json"
FAKE
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH" FIX="$tmp/fix"
required='checks / owner-decisions.md is append-only,checks / A fix leaves its failing test alone,checks / No credentials in the PR range,checks / product.yaml is valid and a published product has its baseline'
review() { jq -n --arg body "VERDICT: $1
Reviewed head: $B" '[{body:$body,author_association:"MEMBER"}]' > "$FIX/comments.json"; }
cloud() { jq --arg body "CLOUD-CI: $1
Tested head: ${2:-$B}" '. + [{body:$body,author_association:"OWNER"}]' "$FIX/comments.json" > "$tmp/comments" && mv "$tmp/comments" "$FIX/comments.json"; }
good() {
  jq -n --arg sha "$A" --arg head "$B" '[{number:7,merged_at:"2026-10-17T00:00:00Z",base:{ref:"main"},merge_commit_sha:$sha,head:{sha:$head}}]' > "$FIX/pulls.json"
  review APPROVE
  jq -n --arg names "$required" '{check_runs:($names | split(",") | to_entries | map({id:(.key+1),name:.value,status:"completed",conclusion:"success"}))} | .total_count=(.check_runs|length)' > "$FIX/runs.json"
}
mutate() { jq "$2" "$FIX/$1.json" > "$tmp/mutated" && mv "$tmp/mutated" "$FIX/$1.json"; }
run() { rc=0; sh "$script" "$@" > "$tmp/out" 2> "$tmp/err" || rc=$?; }
hold() { check "$1" 1 "$rc"; has "hold names the release sha" "EVIDENCE HOLD $A:" out; }

good; run o/r "$A"; check "merged PR, review and required checks pass" 0 "$rc"
has "pass names merge, PR and final head" "EVIDENCE OK $A: #7 head $B" out
[ ! -s "$tmp/err" ]; check "a pass has no stderr" 0 $?
for change in '[]' '.[0].merged_at=null' '.[0].base.ref="other"' '.[0].merge_commit_sha="cccccccccccccccccccccccccccccccccccccccc"' '. + [.[0] | .number=8]'; do
  good; mutate pulls "$change"; run o/r "$A"; hold "ambiguous or non-matching merged PR holds: $change"
done
good; mutate pulls '.[0].base.ref="stable"'; run o/r "$A" --base stable; check "an explicit base is honoured" 0 "$rc"
good; echo '[]' > "$FIX/comments.json"; run o/r "$A"; hold "missing review holds"
has "missing review names the PR head" "no independent APPROVE names head $B of #7" out
good; review 'REQUEST CHANGES'; run o/r "$A"; hold "REQUEST CHANGES on the head holds"
good; mutate runs '.check_runs[0].conclusion="failure"'; cloud PASS; run o/r "$A"; hold "a red check holds even with cloud PASS"
has "red check reason is preserved" "is failure;" out
good; mutate runs '.check_runs=[] | .total_count=0'; run o/r "$A"; hold "a missing required check without cloud PASS holds"
has "missing required check is named" "'checks / A fix leaves its failing test alone' has not run;" out
good; mutate runs '.check_runs=[] | .total_count=0'; cloud PASS; run o/r "$A"; check "cloud PASS on the final head stands in for missing checks" 0 "$rc"
has "cloud stand-in still gives the pass record" "EVIDENCE OK $A: #7 head $B" out
good; mutate runs '.check_runs=[] | .total_count=0'; cloud PASS "$A"; run o/r "$A"; hold "cloud PASS on the merge sha cannot stand in for the head"
good; cloud FAIL; run o/r "$A"; hold "latest cloud FAIL holds even with green checks"
has "cloud FAIL reason is preserved" "the latest cloud CI report on $B is a FAIL" out
good; mutate runs '.check_runs=[] | .total_count=0'; cloud PASS; cloud FAIL; run o/r "$A"; hold "latest cloud report wins"
good; mutate runs '.check_runs=[.check_runs[0]] | .total_count=1'
RELEASE_REQUIRED_CHECKS='checks / owner-decisions.md is append-only' run o/r "$A"; check "required checks can be overridden" 0 "$rc"
# auto_merge's REQUIRED_CHECKS, or an empty override, never replaces the four AI-SDLC checks.
good; mutate runs '.check_runs=[{id:1,name:"test",status:"completed",conclusion:"success"}] | .total_count=1'
REQUIRED_CHECKS=test run o/r "$A"; hold "an inherited REQUIRED_CHECKS=test does not drop the four checks"
REQUIRED_CHECKS= RELEASE_REQUIRED_CHECKS= run o/r "$A"; hold "an empty required list does not drop the four checks"
for failure in PULLS_FAIL COMMENTS_FAIL RUNS_FAIL; do
  good; export "$failure=1"; run o/r "$A"; unset "$failure"
  check "$failure is an error" 2 "$rc"; has "error is labelled on stderr" 'EVIDENCE ERROR:' err
  [ ! -s "$tmp/out" ]; check "an error emits no pass or hold" 0 $?
done
for bad in abc123 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; do
  run o/r "$bad"; check "bad sha is an error: $bad" 2 "$rc"; has "bad input goes to stderr" 'EVIDENCE ERROR:' err
done
run o/r "$A" --base; check "missing base argument is an error" 2 "$rc"
exit "$fail"
