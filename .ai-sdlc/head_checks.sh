#!/bin/sh
# The shared check-run and cloud CI rule for auto-merge and release evidence: a cloud PASS
# stands in for unfinished runs on this head (and for missing runs only when HEAD_CHECKS_STRICT
# is not 1), never for a red run.
#   head_checks.sh <owner/repo> <pr> <head-sha>
# REVIEW_JOB defaults to the independent review job; REQUIRED_CHECKS is comma-separated (test).
# HEAD_CHECKS_STRICT=1 (set by auto_merge.sh): a head with no check run besides the review job,
# or a REQUIRED_CHECKS gate with no run, holds; a cloud PASS stands in only for runs that exist
# and have not finished. REQUIRED_STATUSES (comma-separated commit-status contexts, default none)
# must each be `success` in the head's combined status, read with every page; nothing stands in.
# Exit 0 green (prints a cloud stand-in if used), 1 not green (reason), 2 bad input or gh failure.
set -u
# Report-time observation is optional; merge-time reads below remain authoritative.
# The interface header and exit status distinguish a new trusted helper from an
# older three-argument copy. Exit 1 means a proven contradiction, 2 unavailable.
if [ "${1:-}" = --reconcile-report ]; then
  shift
  exec python3 -I - "$@" <<'RECONCILE_PY'
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile

print("RECONCILIATION-V1")


def unavailable():
    print("Runner reconciliation: unavailable (runner snapshot could not be verified)")
    sys.exit(2)


if len(sys.argv) != 5:
    unavailable()
repo, head, local, overall = sys.argv[1:]
if (not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*", repo)
        or not re.fullmatch(r"[0-9a-f]{40}", head)
        or local not in ("PASS", "FAIL") or overall not in ("PASS", "FAIL")
        or (local == "FAIL" and overall == "PASS")):
    unavailable()
try:
    # GitHub limits the page to 100; also bound captured bytes, time and parsing.
    with tempfile.TemporaryFile() as output:
        fetched = subprocess.run(
            ["gh", "api", f"repos/{repo}/commits/{head}/check-runs?per_page=100"],
            stdout=output, stderr=subprocess.DEVNULL, timeout=60)
        output.seek(0)
        raw = output.read(2 * 1024 * 1024 + 1)
    if fetched.returncode or len(raw) > 2 * 1024 * 1024:
        unavailable()
    snapshot = json.loads(raw)
    count, runs = snapshot["total_count"], snapshot["check_runs"]
    if type(count) is not int or not 0 <= count <= 100 or not isinstance(runs, list) or len(runs) != count:
        unavailable()
    latest = {}
    for run in runs:
        if (not isinstance(run, dict) or type(run.get("id")) is not int or run["id"] <= 0
                or not isinstance(run.get("name"), str) or not 1 <= len(run["name"]) <= 1024
                or not isinstance(run.get("head_sha"), str) or not re.fullmatch(r"[0-9a-f]{40}", run["head_sha"])
                or run.get("status") not in ("completed", "queued", "in_progress", "waiting", "pending", "requested")
                or (run["status"] == "completed" and not isinstance(run.get("conclusion"), str))):
            unavailable()
        if run["head_sha"] != head:
            continue
        previous = latest.get(run["name"])
        if previous is None or run["id"] > previous["id"]:
            latest[run["name"]] = run
    required = os.environ.get("REQUIRED_CHECKS", "test").split(",")
    check = latest.get("test") if "test" in required else None
    comparable = (check is not None and check["status"] == "completed"
                  and check["conclusion"] not in ("neutral", "skipped"))
    conflict = comparable and ((check["conclusion"] == "success") != (local == "PASS"))
    state = "conflict" if conflict else "matching" if comparable else "not comparable"
    print("Runner reconciliation: " + state)
    print("  Observed UTC: " + datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"))
    print("  Local test: " + local + "; local overall: " + overall)
    if comparable:
        print("  Required check: " + json.dumps(check["name"]) + "; runner conclusion: " + json.dumps(check["conclusion"][:200]))
        url = check.get("html_url", "")
        safe = isinstance(url, str) and re.fullmatch(
            r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/(?:actions/runs/[0-9]+(?:/jobs/[0-9]+)?|runs/[0-9]+)", url)
        print("  Run URL: " + (url if safe else "unavailable (not a GitHub run URL)"))
    else:
        print("  Missing, unfinished, neutral/skipped or unmapped test observation; no agreement inferred.")
    sys.exit(1 if conflict else 0)
except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
    unavailable()
RECONCILE_PY
fi
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
required_statuses=${REQUIRED_STATUSES-}
strict=${HEAD_CHECKS_STRICT:-0}
case "$strict" in 0|1) ;; *) fail "HEAD_CHECKS_STRICT must be 0 or 1" ;; esac
# HEAD_CHECKS_CANCELLED_OPEN=1 (set by release_evidence.sh only, #677): a cancelled run counts as
# unfinished, so a cloud PASS on this head stands in for it. cancel_pr_runs.sh and the janitor
# cancel a merged PR's leftover runs on purpose; a merge gate never sets this.
cancelled_open=${HEAD_CHECKS_CANCELLED_OPEN:-0}
case "$cancelled_open" in 0|1) ;; *) fail "HEAD_CHECKS_CANCELLED_OPEN must be 0 or 1" ;; esac

# The latest cloud report on head $1 of PR $2: PASS, FAIL, CONFLICT, or nothing. A report is a comment
# whose author has write, maintain or admin permission on this repository now,
# whose first non-blank line is exactly CLOUD-CI: PASS, FAIL or CONFLICT and whose second is
# exactly `Tested head: <the full 40-character head>`; nothing else in a comment is read.
cloud_ci() {
  # REST, not `gh pr view`: Claude Code cloud sessions refuse GraphQL.
  bodies=$(python3 -I - "$repo" "$2" "$1" <<'CLOUD_PERMISSION_PY'
import json
import os
import re
import subprocess
import sys

repo, pr, head = sys.argv[1:]
permissions = {}


def api(path, paginate=False, *, permission=False):
    command = ["gh", "api"]
    if paginate:
        command.append("--paginate")
    command.append(path)
    if paginate:
        command.extend(["--jq", ".[] | @json"])
    environment = None
    if permission and os.environ.get("GH_PERMISSION_TOKEN"):
        environment = dict(os.environ, GH_TOKEN=os.environ["GH_PERMISSION_TOKEN"])
    result = subprocess.run(command, capture_output=True, timeout=30, env=environment)
    if result.returncode or len(result.stdout) > 8 * 1024 * 1024:
        raise ValueError("GitHub metadata could not be read")
    return result.stdout.decode("utf-8")


def allowed(login):
    key = login.casefold()
    if key not in permissions:
        record = json.loads(api(f"repos/{repo}/collaborators/{login}/permission", permission=True))
        if not isinstance(record, dict):
            raise ValueError("permission answer is not an object")
        role = record.get("role_name")
        if "role_name" in record and (not isinstance(role, str) or not role):
            raise ValueError("permission role is malformed")
        user = record.get("user")
        flags = [record["permissions"]] if "permissions" in record else []
        if isinstance(user, dict) and "permissions" in user:
            flags.append(user["permissions"])
        keys = ("push", "maintain", "admin")
        for values in flags:
            if (not isinstance(values, dict) or not any(key in values for key in keys)
                    or any(type(values[key]) is not bool for key in keys if key in values)):
                raise ValueError("permission flags are malformed")
        if role is None and not flags:
            raise ValueError("permission answer has no role or permission flags")
        permissions[key] = role in {"write", "maintain", "admin"} or any(
            values.get(name) is True for values in flags for name in keys)
    return permissions[key]


try:
    records = api(f"repos/{repo}/issues/{pr}/comments?per_page=100", paginate=True)
    for line in records.splitlines():
        if not line.strip():
            continue
        comment = json.loads(line)
        if not isinstance(comment, dict):
            raise ValueError("comment metadata is malformed")
        body, user = comment.get("body"), comment.get("user")
        if not isinstance(body, str) or not isinstance(user, dict):
            continue
        login = user.get("login")
        if not isinstance(login, str) or login.casefold().endswith("[bot]"):
            continue
        if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?", login) or "--" in login:
            continue
        # Limit permission reads to reports that can decide this head. The awk parser below
        # still decides the verdict, using its existing lexical and record-order rules.
        lines = [line.rstrip("\r") for line in body.split("\n") if line.strip()]
        if len(lines) < 2 or not re.fullmatch(r"CLOUD-CI: (PASS|FAIL|CONFLICT)[ \t]*", lines[0]):
            continue
        tested = re.fullmatch(r"Tested head:[ \t]*`?([0-9a-f]+)`?[ \t]*", lines[1])
        if tested is None or tested.group(1) != head:
            continue
        if allowed(login):
            print(body + "\x1e", end="")
except (OSError, ValueError, UnicodeError, subprocess.SubprocessError):
    print("cloud CI repository permission could not be verified", file=sys.stderr)
    sys.exit(1)
CLOUD_PERMISSION_PY
  ) && bodies="${bodies}x" || return 1
  printf '%s' "${bodies%x}" | HEAD_SHA="$1" awk 'BEGIN { RS = "\036"; FS = "\n" }
    {
      v = ""; n = 0
      for (i = 1; i <= NF && n < 2; i++) {
        line = $i; sub(/\r$/, "", line)
        if (line ~ /^[[:space:]]*$/) continue
        n++
        if (n == 1) {
          if (line !~ /^CLOUD-CI: (PASS|FAIL|CONFLICT)[ \t]*$/) break
          v = line; sub(/^CLOUD-CI: /, "", v); sub(/[ \t]*$/, "", v)
        } else if (line ~ /^Tested head:[ \t]*`?[0-9a-f]+`?[ \t]*$/) {
          h = line; sub(/^Tested head:[ \t]*`?/, "", h); sub(/`?[ \t]*$/, "", h)
          if (h == ENVIRON["HEAD_SHA"]) last = v
        }
      }
    }
    END { print last }'
}
# HEAD_CHECKS_CLOUD_ONLY=1 (release_evidence.sh, release baseline): print only that latest report.
if [ "${HEAD_CHECKS_CLOUD_ONLY:-0}" = 1 ]; then
  cloud_ci "$sha" "$pr" || fail "could not read the comments of #$pr"
  exit 0
fi

# gh --paginate emits separate objects; merge complete pages before choosing latest names.
# Keep the historical incomplete-read phrase for callers that distinguish it from red checks.
check_hold() {
  if [ -n "$total" ] && [ "$total" -gt 100 ]; then
    hold "more than 100 check runs, not all read: $*"
  fi
  # bot_review.sh reads "more than 100 check runs" as "not all read", not red.
  hold "check runs not all read (handled like more than 100 check runs): $*"
}
all_runs='[]' total="" collected=0 page=1
while [ "$page" -le 10 ]; do
  page_json=$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100&page=$page") \
    || {
      # Preserve the first-page API error contract used by release callers.
      [ "$page" -ne 1 ] || fail "could not read page $page of the check runs of $sha"
      check_hold "page $page is unreadable"
    }
  metadata=$(printf '%s\n' "$page_json" | jq -ser '
    if length == 1 and (.[0] |
      type == "object" and (.total_count | type == "number" and . >= 0 and floor == .)
      and (.check_runs | type == "array" and length <= 100)
      and all(.check_runs[];
        type == "object" and (.id | type == "number" and . > 0 and floor == .)
        and (.name | type == "string" and length > 0)
        and (.status | type == "string" and length > 0)
        and (.conclusion | . == null or type == "string")))
    then .[0] | [.total_count, (.check_runs | length)] | @tsv
    else error("malformed check-run page") end' 2>/dev/null) \
    || check_hold "page $page is malformed"
  old_ifs=$IFS; IFS=$(printf '\t'); set -- $metadata; IFS=$old_ifs
  page_total=$1 page_count=$2
  if [ -z "$total" ]; then total=$page_total; fi
  [ "$total" = "$page_total" ] || check_hold "total_count changed on page $page"
  [ "$total" -le 1000 ] || check_hold "total_count exceeds 1000"
  all_runs=$(printf '%s\n%s\n' "$all_runs" "$page_json" | jq -sc '.[0] + .[1].check_runs') \
    || check_hold "page $page could not be merged"
  collected=$((collected+page_count))
  [ "$page" -ne 10 ] || [ "$page_count" -lt 100 ] || check_hold "page 10 is full"
  [ "$collected" -le "$total" ] || check_hold "collected exceeds total_count on page $page"
  [ "$collected" -ne "$total" ] || break
  [ "$page_count" -eq 100 ] || check_hold "short page $page (collected $collected of total_count $total)"
  page=$((page+1))
done
[ "$collected" -eq "$total" ] || check_hold "collected $collected differs from total_count $total"
runs=$(printf '%s\n' "$all_runs" | jq -r 'group_by(.name) | map(max_by(.id)) | .[] |
  [.name, .status, (.conclusion // "none"), ((.check_suite.id // "") | tostring)] | join("\u001f")') \
  || check_hold "merged check runs are malformed"
# bad: a run that finished red (nothing stands in for it); open: a run that has not finished, or,
# only when HEAD_CHECKS_STRICT is not 1, a required run that is not there (a cloud CI PASS on this
# head stands in for these). With HEAD_CHECKS_STRICT=1 a missing run goes to bad.
bad="" open="" missing=""
seen="" measured=0
us=$(printf '\037')
# Only cancellations need Actions read access. Validate the whole page before using any
# replacement, so a failed, malformed or truncated read leaves every cancellation bad.
live_suites="" workflow_unreadable=""
while IFS="$us" read -r name status conclusion suite; do
  [ "$status" = completed ] && [ "$conclusion" = cancelled ] || continue
  live_suites=$(gh api "repos/$repo/actions/runs?head_sha=$sha&per_page=100" --jq '
    def positive_id: type == "number" and . > 0 and floor == .;
    if (type == "object" and (.total_count | type == "number" and . >= 0 and floor == .)
        and (.workflow_runs | type == "array")
        and .total_count == (.workflow_runs | length)
        and all(.workflow_runs[];
          (.id | positive_id) and (.check_suite_id | positive_id) and (.workflow_id | positive_id)
          and (.head_sha | type == "string" and test("^[0-9a-f]{40}$"))
          and (.event | type == "string" and length > 0)
          and (.status | . == "completed" or . == "queued" or . == "in_progress"
            or . == "waiting" or . == "pending" or . == "requested")))
    then .workflow_runs as $runs |
      [$runs[] as $w |
        ([$runs[] | select(.workflow_id == $w.workflow_id and .head_sha == $w.head_sha
          and .event == $w.event and .id > $w.id)] | max_by(.id)) |
        select(.status == "queued" or .status == "in_progress" or .status == "waiting"
          or .status == "pending" or .status == "requested") | $w.check_suite_id]
      | unique | map(tostring) | join(" ")
    else error("workflow runs unreadable") end' 2>/dev/null) \
    || { live_suites=""; workflow_unreadable=" (workflow runs unreadable)"; }
  break
done <<EOF
$runs
EOF
while IFS="$us" read -r name status conclusion suite; do
  if [ -z "$name" ]; then
    [ "$status" = too-many ] && bad="$bad more than 100 check runs, not all read;"
    continue
  fi
  seen="$seen$name$us"
  [ "$name" = "$review_job" ] && continue
  measured=$((measured + 1))
  if [ "$status" != completed ]; then open="$open '$name' is $status;"; continue; fi
  if [ "$conclusion" = cancelled ]; then
    case " $live_suites " in
      *" $suite "*)
        if [ -n "$suite" ]; then
          open="$open '$name' was cancelled by a newer run of its workflow that has not finished;"
          continue
        fi ;;
    esac
    if [ "$cancelled_open" = 1 ]; then open="$open '$name' is cancelled;"; continue; fi
    bad="$bad '$name' is cancelled$workflow_unreadable;"
    continue
  fi
  case "$conclusion" in success|skipped|neutral) ;; *) bad="$bad '$name' is $conclusion;" ;; esac
done <<EOF
$runs
EOF
old_ifs=$IFS; IFS=,
for want in $required; do
  case "$us$seen" in *"$us$want$us"*) ;; *) missing="$missing '$want' has not run;" ;; esac
done
IFS=$old_ifs
if [ "$strict" = 1 ]; then
  [ "$measured" -gt 0 ] || [ -n "$bad" ] || bad="$bad no check runs on the head;"
  bad="$bad$missing"
else
  open="$open$missing"
fi
if [ -n "$required_statuses" ]; then
  # Combined status: the latest status per context; --paginate reads every page of contexts.
  statuses=$(gh api --paginate "repos/$repo/commits/$sha/status?per_page=100" \
    --jq '.statuses[] | [.context, .state] | join("\u001f")') \
    || fail "could not read the commit statuses of $sha"
  old_ifs=$IFS; IFS=,
  for want in $required_statuses; do
    [ -n "$want" ] || continue
    # Every record must be exactly `context<US>state`; contexts compare as strings, never as numbers.
    state=$(printf '%s\n' "$statuses" | awk -F "$us" -v want="$want" 'NF == 0 { next } NF != 2 { bad = 1 } NF == 2 && ($1 "") == (want "") { s = $2 } END { if (bad) print "MALFORMED"; else print s }')
    case "$state" in
      MALFORMED) fail "a commit status of $sha is not a single context and state" ;;
      success) ;;
      "") bad="$bad status '$want' is not set;" ;;
      *) bad="$bad status '$want' is $state;" ;;
    esac
  done
  IFS=$old_ifs
fi
[ -z "$bad" ] || hold "$bad$open"
cloud=$(cloud_ci "$sha" "$pr") || fail "could not read the comments of #$pr"
[ "$cloud" != FAIL ] || hold "the latest cloud CI report on $sha is a FAIL"
[ "$cloud" != CONFLICT ] || hold "the latest cloud CI report on $sha is a CONFLICT"
if [ -n "$open" ]; then
  [ "$cloud" = PASS ] || hold "$open no cloud CI PASS on this head"
  echo "the cloud CI PASS on $sha stands in for:$open"
fi
exit 0
