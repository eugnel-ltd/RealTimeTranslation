#!/bin/sh
# Review-on-head check: the PR carries a trusted APPROVE for exactly this head.
#
#   review_on_head.sh <pr-number> <head-sha> [--repo owner/name] [--auto-merge [--gate [--two]]] [--remediates <sha>]
#   review_on_head.sh --tier <pr-number> --repo owner/name
#
# --tier reads every changed file and the PR file count, then prints `two-review <file>`,
# `gate <file>` or `ordinary`. Two-review paths (CODEOWNERS, rulesets, apply_ruleset.sh) win;
# either rename name counts. Test patches adding or removing a 64-hex digest, or missing their
# patch, are gate tier.
# Read errors, 3000 or more files and incomplete file lists exit 2.
#
# --gate requires --auto-merge and one trusted exact-head APPROVE after the latest rejection or
# ambiguity whose reviewer company differs from every writer company (owner, 25 Oct 2026: "I need
# only 1 vender reviewer"). It needs visible, unique `Owner guards: unchanged|loosened`,
# `Stop: nothing` and matching `Expenditure:` lines. --two (with --gate), or any counted APPROVE
# that says `Owner guards: loosened`, needs two such APPROVEs whose companies also differ from
# each other. Unknown vendors hold. Success prints `ROH-GATE reviewers=<id>` or
# `ROH-GATE reviewers=<id1>,<id2>`; every counted review uses the normal trust,
# maturity and live repository-permission checks below. Raw parser fixtures retain supplied order.
#
# Production reads trusted comment metadata, then fresh PR state/server Date. It orders relevant
# events by updated_at; an equally-latest rejection/ambiguity holds. Historical approval must
# predate merge. Open approvals need server-second maturity. The `Author agents:`, `Reviewer agent:`
# and `Independence:` lines are a record for ordinary reviews, required under --gate or when the
# Reviewer vendor rule below applies. On the plain path only, a formal APPROVED review by the
# pinned eugnel-bot account also counts. On every path but --remediates, a person's formal APPROVED
# review on the exact head, by a write, maintain or admin collaborator who is not the PR author, counts as an
# independent reviewer of company `human` (one of the two under --two); their formal
# CHANGES_REQUESTED holds. Raw lexical input below attests none of this provenance and cannot
# satisfy the forced release path.
# An author may be an ops author `ops:<name>/agent:<agent-name>` (normally `agent:writer`) when no
# agent session wrote the change; the reviewer is always a session. An ops author with no vendor
# adds no company, but the AI co-author trailers on the PR's commits and a vendor on the body's
# `Written by:` line then count as writer companies (owner, 25 Oct 2026).
# One writer company per open PR (#698): those trailers (merge commits skipped) and that line always
# count, and two writer companies hold. A commit marked `Orchestrated-by: Claude` adds no Anthropic
# writer; the approval then needs one `Orchestrator edits within the writer's direction: yes|no`
# line, and `no` makes Anthropic a writer.
#
# Every counted author needs current write, maintain or admin repository access. The run checks
# the collaborator-permission API once per login; a failed or malformed lookup exits 2. A login
# ending in [bot] never counts. Historical replay uses the same live permission rule.
# The parser reads bodies in supplied order. A comment is a review only when its first
# non-blank line is exactly the verdict (`VERDICT: APPROVE`, `VERDICT: REQUEST CHANGES`, or the
# `**Verdict:**` form) and its second non-blank line is exactly `Reviewed head: <sha>` (12 to 40
# hex characters, backticks allowed). The lexical parser reads no Markdown, no
# fences, no quotes. The check holds when unsure: a comment that carries the two lines on top and
# then any further line starting with `VERDICT:`, `**Verdict:**` or `Reviewed head:` at column 0
# is ambiguous and counts as a REQUEST CHANGES for the head it named, and for this head when any
# of those lines names it. The same holds for any comment that carries such a line outside the two
# lines on top (a verdict with no head under it, a bare line pasted from another review): it holds
# this head unless every head it names is another head. Quote an earlier review with `> ` on every
# line, or not at all. Of the reviews whose head is a prefix of this head, the latest decides.
#
# Reviewer vendor rule: the reviewer's company must differ from every author's company (agent names
# `writer/<v>` and `reviewer/<v>`, vendor map in modules/review.md). An ops author with no vendor
# (`ops:<name>/agent:writer`, a person or script) adds no company. The rule needs the canonical
# independent-agent
# fields; missing or malformed fields, an unknown or missing vendor, or a matching company holds.
# It applies to every open PR in every repo (owner, 25 Oct 2026). For merged PRs (release replay)
# it applies only from the date in the optional line in the root REVIEW.md of the default branch
# (read with no ref, so a PR cannot switch it off for itself), at column 0 and outside fences,
# quotes and comments: `Reviewer vendor: distinct from every writer since YYYY-MM-DD` (00:00 UTC),
# so older merges keep the rule they merged under. A 404 means no line; a duplicate or malformed
# line holds; any other read failure exits 2. Not read on the lexical-only path.
#
# --auto-merge (scripts/auto_merge.sh) also asks the reviewer's word on the two things an
# automatic merge must not skip. The latest review of this head must be an APPROVE that carries,
# at column 0, exactly one `Stop:` line and it says `Stop: nothing`, and exactly one
# `Expenditure:` line matching EXPECT_EXPENDITURE: exactly `none` (the default) or `approved`.
# Trailing spaces are allowed. The reviewer writes them after reading the PR body, the ledger
# and any expenditure decision; a missing, repeated, mismatched or other value holds the PR.
#
# --remediates <40 lowercase hex> (scripts/release_remediation.sh) asks the reviewer's word that
# this head fixes a held release commit. The latest review of this head must be an APPROVE with a
# `Remediates: <that sha>` line at column 0, outside code fences, `>` quotes, indented blocks and
# HTML comments (the lines the identity fields use). Several `Remediates:` lines are fine when each
# names a distinct full sha; a repeated or malformed one, a line only in hidden text, or an unclosed
# fence or comment holds. It combines with --auto-merge.
#
#   exit 0  the latest review of this head is an APPROVE (with --auto-merge: one that says
#           `Stop: nothing` and `Expenditure: <EXPECT_EXPENDITURE>`; with --remediates: one that
#           names the sha in a visible `Remediates:` line)
#   exit 1  no review names this head, or the latest one is a REQUEST CHANGES or ambiguous, or
#           (with the Reviewer vendor rule, --gate, --auto-merge or --remediates) does not say what is asked
#   exit 2  the inputs are wrong or gh failed
#
# REVIEW_ON_HEAD_COMMENTS supplies raw bodies, each ended by record separator byte 036,
# without gh or author metadata. It is for parser tests and trusted callers that authenticate
# metadata themselves (such as public adopters' wrappers); this input cannot attest trust.
set -u
usage="usage: review_on_head.sh <pr> <sha> [--repo owner/name] [--auto-merge [--gate [--two]]] [--remediates <sha>]; review_on_head.sh --tier <pr> --repo owner/name"
tier=0 gate=0 two=0
if [ "${1:-}" = --tier ]; then
  tier=1; pr=${2:-}; sha=""
else
  pr=${1:-}; sha=${2:-}
fi
shift 2 2>/dev/null || { echo "$usage" >&2; exit 2; }
repo="" auto=0 remediates=""
while [ $# -gt 0 ]; do
  case $1 in
    --repo) repo=${2:-}; [ -n "$repo" ] || { echo "$usage" >&2; exit 2; }; shift 2 ;;
    --auto-merge) auto=1; shift ;;
    --gate) gate=1; shift ;;
    --two) two=1; shift ;;
    --remediates)
      [ -z "$remediates" ] && [ -n "${2:-}" ] || { echo "$usage" >&2; exit 2; }
      remediates=$2; shift 2 ;;
    *) echo "$usage" >&2; exit 2 ;;
  esac
done
[ "$gate" = 0 ] || [ "$auto" = 1 ] || { echo "$usage" >&2; exit 2; }
[ "$two" = 0 ] || [ "$gate" = 1 ] || { echo "$usage" >&2; exit 2; }
[ "$two" = 0 ] || gate=2
if [ "$tier" = 1 ]; then
  [ -n "$repo" ] && [ "$auto" = 0 ] && [ "$gate" = 0 ] && [ -z "$remediates" ] || { echo "$usage" >&2; exit 2; }
fi
if [ -n "$remediates" ]; then
  case "$remediates" in
    *[!0123456789abcdef]*) echo "REVIEW-ON-HEAD RECORD ERROR: --remediates must be 40 lowercase hex characters" >&2; exit 2 ;;
  esac
  [ ${#remediates} -eq 40 ] || { echo "REVIEW-ON-HEAD RECORD ERROR: --remediates must be 40 lowercase hex characters" >&2; exit 2; }
fi
expect_expenditure=${EXPECT_EXPENDITURE-none}
[ "$tier" = 0 ] || expect_expenditure=none
case "$expect_expenditure" in
  none|approved) ;;
  *) echo "REVIEW-ON-HEAD RECORD ERROR: EXPECT_EXPENDITURE must be exactly 'none' or 'approved'" >&2; exit 2 ;;
esac
if [ "$tier" = 0 ]; then
case "$sha" in
  *[!0-9a-f]*|"") echo "REVIEW-ON-HEAD RECORD ERROR: head sha must be hex: '$sha'" >&2; exit 2 ;;
esac
[ ${#sha} -ge 12 ] || { echo "REVIEW-ON-HEAD RECORD ERROR: head sha must have 12 or more characters" >&2; exit 2; }
fi
case "$pr" in
  ""|*[!0-9]*) echo 'REVIEW-ON-HEAD RECORD ERROR: PR number must be numeric' >&2; exit 2 ;;
esac

# ai-sdlc-review-provenance: 1
# Production requires Python3's standard library; raw lexical fixtures below remain compatible.
if [ "$tier" = 1 ] || [ "$gate" != 0 ] || [ -z "${REVIEW_ON_HEAD_COMMENTS:-}" ] || [ "${REVIEW_ON_HEAD_REQUIRE_PROVENANCE:-0}" = 1 ]; then
  command -v python3 >/dev/null || { echo 'REVIEW-ON-HEAD RECORD ERROR: python3 not installed' >&2; exit 2; }
  where=${repo:-"{owner}/{repo}"}
  python3 -I - "$pr" "$sha" "$where" "$auto" "$expect_expenditure" "$0" "$remediates" "$gate" "$tier" <<'PROVENANCE'
from datetime import datetime, timezone
from email.utils import format_datetime, parsedate_to_datetime
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

PR, HEAD, WHERE, AUTO, EXPENDITURE, SCRIPT, REMEDIATES, GATE, TIER = sys.argv[1:]
PERMISSIONS = {}  # Shared by comments, formal reviews and the bounded maturity retry.
ID = r"session:[0-9a-f]{32}/agent:[a-z0-9][a-z0-9_/-]{0,95}"
# The lookahead caps the name at 39 characters.
OPS_ID = r"ops:(?=[a-z0-9-]{1,39}/)[a-z0-9](?:-?[a-z0-9])*/agent:[a-z0-9][a-z0-9_/-]{0,95}"
IDENTITY_FIELDS = ("Author agents:", "Reviewer agent:", "Independence:")
VENDORS = {"codex": "openai", "dot": "openai", "grok": "xai", "grokbot": "xai",
           "claude": "anthropic", "claude-team": "anthropic", "orchestrator": "anthropic",
           "cursor": "cursor", "antigravity": "google", "antigravity-mac": "google",
           "gemini": "google"}


class Hold(Exception):
    pass


class ReadError(Exception):
    pass


class UnknownVendor(Hold):
    pass


def api(path, *, paginate=False, include=False, query=None, permission=False):
    command = ["gh", "api"]
    if paginate:
        command.append("--paginate")
    if include:
        command.append("--include")
    command.append(path)
    if query is not None:
        command.extend(["--jq", query])
    environment = None
    if permission and os.environ.get("GH_PERMISSION_TOKEN"):
        environment = dict(os.environ, GH_TOKEN=os.environ["GH_PERMISSION_TOKEN"])
    try:
        result = subprocess.run(command, capture_output=True, timeout=30, env=environment)
    except (OSError, subprocess.TimeoutExpired):
        raise ReadError("GitHub metadata could not be read") from None
    if result.returncode:
        raise ReadError("GitHub metadata could not be read")
    if len(result.stdout) > 8 * 1024 * 1024:
        raise ReadError("GitHub metadata exceeds the supported bound")
    try:
        return result.stdout.decode("utf-8")
    except UnicodeDecodeError:
        raise ReadError("GitHub metadata is not UTF-8") from None


def document(text):
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        raise ReadError("GitHub metadata is not valid JSON") from None


def classify():
    """Read the complete file list before allowing even an ordinary classification."""
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", WHERE):
        raise ReadError("--tier requires an owner/name repository")
    text = api(f"repos/{WHERE}/pulls/{PR}/files", paginate=True)
    files, position, decoder = [], 0, json.JSONDecoder()
    while position < len(text):
        if text[position].isspace():
            position += 1
            continue
        try:
            page, position = decoder.raw_decode(text, position)
        except ValueError:
            raise ReadError("PR files are not valid paginated JSON") from None
        if not isinstance(page, list):
            raise ReadError("PR files page is not a list")
        files.extend(page)
    pr = document(api(f"repos/{WHERE}/pulls/{PR}"))
    count = pr.get("changed_files") if isinstance(pr, dict) else None
    if (type(count) is not int or count < 0 or count >= 3000 or len(files) >= 3000
            or len(files) != count or not text.strip()):
        raise ReadError("PR file list is incomplete or has 3000 or more files")
    prefixes = (".github/workflows/", "templates/workflows/", ".ai-sdlc/",
                ".claude/hooks/", "hooks/")
    paths = {".claude/settings.json", "scripts/auto_merge.sh", "scripts/org_auto_merge.sh",
             "scripts/review_on_head.sh", "scripts/head_checks.sh", "scripts/bot_review.sh",
             "scripts/cancel_pr_runs.sh", "scripts/intent_closing_refs.sh",
             "scripts/merge_past_queue.sh", "scripts/release_evidence.sh", "scripts/cloud_ci.sh", "scripts/ci_report.sh",
             "scripts/ci_janitor.py", "scripts/runner_watchdog.sh", "config/auto-merge-repos.tsv",
             "docs/release-baseline.txt"}
    two, gate, seen = None, None, set()
    for file in files:
        if not isinstance(file, dict):
            raise ReadError("PR file metadata is malformed")
        names = [file.get("filename")]
        if "previous_filename" in file:
            names.append(file["previous_filename"])
        if any(not isinstance(name, str) or not name or any(ord(c) < 32 or ord(c) == 127 for c in name)
               for name in names):
            raise ReadError("PR file path is malformed")
        if names[0] in seen:
            raise ReadError("PR file list repeats a file")
        seen.add(names[0])
        if "patch" in file and not isinstance(file["patch"], str):
            raise ReadError("PR file patch is malformed")
        for name in names:
            if (name.rsplit("/", 1)[-1] == "CODEOWNERS" or name.startswith("templates/rulesets/")
                    or name == "scripts/apply_ruleset.sh"):
                two = two or name
            if name.startswith(prefixes) or name in paths:
                gate = gate or name
            if any(part in {"tests", "test"} for part in name.split("/")[:-1]):
                if "patch" not in file or any(
                    line.startswith(("+", "-")) and not line.startswith(("+++", "---"))
                    and re.search(r"[0-9a-fA-F]{64}", line)
                    for line in file.get("patch", "").splitlines()
                ):
                    gate = gate or name
    print("two-review " + two if two else "gate " + gate if gate else "ordinary")


def instant(value):
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value
    ):
        raise Hold("review timestamps must be valid timezone-aware instants")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        raise Hold("review timestamps must be valid timezone-aware instants") from None


def sha(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


def included(path, description):
    text = api(path, include=True)
    headers, separator, body = text.replace("\r\n", "\n").partition("\n\n")
    if not separator or not re.fullmatch(r"HTTP/\d(?:\.\d)? 200(?: .*)?", headers.splitlines()[0]):
        raise Hold(f"{description} response has no trusted successful HTTP observation")
    dates = [line.split(":", 1)[1].strip() for line in headers.splitlines()[1:]
             if line.split(":", 1)[0].lower() == "date"]
    if len(dates) != 1:
        raise Hold(f"{description} response must contain exactly one trusted server Date")
    try:
        observed = parsedate_to_datetime(dates[0])
        if observed.tzinfo is None or format_datetime(observed, usegmt=True) != dates[0]:
            raise ValueError
    except (ValueError, TypeError, OverflowError):
        raise Hold(f"{description} response has an invalid trusted server Date") from None
    return document(body), observed


def observe():
    pr, observed = included(f"repos/{WHERE}/pulls/{PR}", "PR")
    if not isinstance(pr, dict) or type(pr.get("number")) is not int or pr["number"] != int(PR):
        raise Hold("PR metadata does not identify this PR")
    full_head = pr.get("head", {}).get("sha") if isinstance(pr.get("head"), dict) else None
    if not sha(full_head) or not full_head.startswith(HEAD):
        raise Hold("PR head changed or does not match the requested head")
    base = pr.get("base")
    base_repo = base.get("repo") if isinstance(base, dict) else None
    if (not isinstance(base, dict) or not isinstance(base.get("ref"), str) or not base["ref"]
            or len(base["ref"]) > 255 or any(ord(character) < 32 for character in base["ref"])
            or not isinstance(base_repo, dict) or not isinstance(base_repo.get("full_name"), str)
            or base_repo["full_name"].casefold() != WHERE.casefold()):
        raise Hold("PR base does not identify a branch in this repository")
    merged = pr.get("merged")
    if type(merged) is not bool or pr.get("state") != ("closed" if merged else "open"):
        raise Hold("PR state cannot attest an open or merged review")
    cutoff = instant(pr.get("merged_at")) if merged else None
    if cutoff is not None and (cutoff > observed or not sha(pr.get("merge_commit_sha"))):
        raise Hold("merged PR metadata has contradictory chronology or commit identity")
    if not merged and pr.get("merged_at") is not None:
        raise Hold("open PR metadata has a merge timestamp")
    return pr, observed, cutoff


def reviewer(comment):
    user = comment.get("user")
    if not isinstance(user, dict):
        return None
    login, user_id = user.get("login"), user.get("id")
    if (not isinstance(login, str)
            or re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?", login) is None
            or "--" in login
            or type(user_id) is not int or user_id <= 0):
        return None
    return login, user_id


def permission(comment):
    who = reviewer(comment)
    if who is None:
        return None
    login, _ = who
    key = login.casefold()
    if key not in PERMISSIONS:
        record = document(api(f"repos/{WHERE}/collaborators/{login}/permission", permission=True))
        if not isinstance(record, dict):
            raise ReadError("collaborator permission response is malformed")
        role = record.get("role_name")
        if "role_name" in record and (not isinstance(role, str) or not role):
            raise ReadError("collaborator role is malformed")
        user = record.get("user")
        flags = [record["permissions"]] if "permissions" in record else []
        if isinstance(user, dict) and "permissions" in user:
            flags.append(user["permissions"])
        keys = ("push", "maintain", "admin")
        for values in flags:
            if (not isinstance(values, dict) or not any(key in values for key in keys)
                    or any(type(values[key]) is not bool for key in keys if key in values)):
                raise ReadError("collaborator permission flags are malformed")
        if role is None and not flags:
            raise ReadError("collaborator permission response has no role or permission flags")
        allowed = role if role in {"write", "maintain", "admin"} else None
        if allowed is None:
            for flag, name in (("admin", "admin"), ("maintain", "maintain"), ("push", "write")):
                if any(values.get(flag) is True for values in flags):
                    allowed = name
                    break
        PERMISSIONS[key] = (login, allowed)
    login, role = PERMISSIONS[key]
    return (login, role) if role is not None else None


def identity_lines(body):
    """Keep literal attestation columns; examples cannot create or duplicate a field."""
    lines, fence, comment = [], None, False
    for line in body.split("\n"):
        line = line[:-1] if line.endswith("\r") else line
        if fence is not None:
            character, length = fence
            if re.fullmatch(r" {0,3}" + re.escape(character) + "{" + str(length) + r",}[ \t]*", line):
                fence = None
            continue
        if not comment:
            if line.startswith(("    ", "\t")) or re.match(r" {0,3}>", line):
                continue
            opening = re.fullmatch(r" {0,3}(`{3,}|~{3,})(.*)", line)
            if opening is not None:
                marker, information = opening.groups()
                if marker[0] == "`" and "`" in information:
                    raise Hold("identity context has an ambiguous code fence")
                fence = (marker[0], len(marker))
                continue
        visible, position = [], 0
        while position < len(line):
            if comment:
                closing = line.find("-->", position)
                end = len(line) if closing < 0 else closing + 3
                visible.append(" " * (end - position))
                position = end
                if closing >= 0:
                    comment = False
            else:
                opening = line.find("<!--", position)
                if opening < 0:
                    visible.append(line[position:])
                    break
                visible.append(line[position:opening])
                visible.append(" " * 4)
                position, comment = opening + 4, True
        lines.append("".join(visible))
    if fence is not None or comment:
        raise Hold("identity context has an unclosed code fence or HTML comment")
    return lines


def identity(body):
    lines = identity_lines(body)
    present = any(line.lstrip(" \t").lower().startswith(tuple(x.lower() for x in IDENTITY_FIELDS))
                  for line in lines)
    if not present:
        return False
    values = []
    for field in IDENTITY_FIELDS:
        found = [line for line in lines if line.lstrip(" \t").lower().startswith(field.lower())]
        if len(found) != 1 or not found[0].startswith(field):
            raise Hold("approval has incomplete or repeated independent-agent fields")
        values.append(found[0][len(field):].strip(" \t"))
    authors, reviewer, statement = values
    author_id = r"(?:" + ID + "|" + OPS_ID + ")"
    if not re.fullmatch(author_id + r"(?:, *" + author_id + r"){0,15}", authors) or not re.fullmatch(ID, reviewer):
        raise Hold("approval has malformed canonical independent-agent IDs")
    names = [name.strip(" ") for name in authors.split(",")]
    if len(set(names)) != len(names) or reviewer in names:
        raise Hold("reviewer must differ from every distinct author agent")
    if statement != "did not author this change":
        raise Hold("approval lacks the independent-agent attestation")
    return True


def policy_text():
    """REVIEW.md of the default branch (no ref); the HTTP status line is kept when gh exits 1."""
    command = ["gh", "api", "--include", f"repos/{WHERE}/contents/REVIEW.md"]
    try:
        result = subprocess.run(command, capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        raise ReadError("REVIEW.md policy could not be read") from None
    if len(result.stdout) > 8 * 1024 * 1024:
        raise ReadError("REVIEW.md policy response exceeds the supported bound")
    try:
        text = result.stdout.decode("utf-8")
    except UnicodeDecodeError:
        raise ReadError("REVIEW.md policy response is not UTF-8") from None
    headers, separator, body = text.replace("\r\n", "\n").partition("\n\n")
    status = re.fullmatch(r"HTTP/\d(?:\.\d)? (\d{3})(?: .*)?", headers.splitlines()[0]) if headers else None
    if not separator or status is None:
        raise ReadError("REVIEW.md policy response has no HTTP status")
    record = document(body)
    if status.group(1) == "404":
        if isinstance(record, dict) and record.get("message") == "Not Found":
            return None
        raise ReadError("REVIEW.md policy 404 response is not a Not Found record")
    if status.group(1) != "200":
        raise ReadError("REVIEW.md policy could not be read")
    if (not isinstance(record, dict) or record.get("type") != "file"
            or record.get("encoding") != "base64" or not isinstance(record.get("content"), str)):
        raise ReadError("REVIEW.md policy response is not a base64 file")
    try:
        return base64.b64decode(record["content"]).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        raise ReadError("REVIEW.md policy content is not UTF-8") from None


def policy_start():
    """The instant the opt-in `Reviewer vendor:` rule starts, or None when the repo has not opted in."""
    text = policy_text()
    if text is None:
        return None
    found = [line for line in identity_lines(text) if line.startswith("Reviewer vendor:")]
    if not found:
        return None
    if len(found) > 1:
        raise Hold("REVIEW.md has more than one Reviewer vendor line")
    match = re.fullmatch(r"Reviewer vendor: distinct from every writer since (\d{4}-\d{2}-\d{2}) *", found[0])
    try:
        return datetime.strptime(match.group(1), "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (AttributeError, ValueError):
        raise Hold("REVIEW.md has a malformed Reviewer vendor line") from None


def vendor_company(agent):
    parts = agent.split("/agent:", 1)[1].split("/")
    if len(parts) < 2 or parts[0] not in {"writer", "reviewer"} or parts[1] not in VENDORS:
        raise UnknownVendor("approval does not name a known reviewer or writer vendor")
    return VENDORS[parts[1]]


# Words in a commit's co-author trailer or the PR body's `Written by:` line that name an AI company.
AI_WORDS = {"claude": "anthropic", "anthropic": "anthropic", "codex": "openai", "openai": "openai",
            "chatgpt": "openai", "dot": "openai", "grok": "xai", "grokbot": "xai", "xai": "xai",
            "cursor": "cursor", "gemini": "google", "antigravity": "google"}
HUMAN = "\0human:"


def ai_companies(text):
    return {AI_WORDS[word] for word in re.findall(r"[a-z]+", text.casefold()) if word in AI_WORDS}


def hidden_writers(pr):
    """Owner, 25 Oct 2026: an ops author cannot hide an AI writer. AI co-author trailers on the
    PR's non-merge commits and a vendor named on the body's `Written by:` line count as writer
    companies. #698: a merge commit never counts, and a commit marked `Orchestrated-by: Claude`
    adds no Anthropic writer by itself (the review's direction line decides). Returns the
    companies and the number of orchestrator commits."""
    companies, orchestrated = set(), 0
    body = pr.get("body") if isinstance(pr, dict) else None
    if isinstance(body, str):
        for line in re.findall(r"^(?:- )?Written by:(.*)$", body, re.I | re.M):
            companies |= ai_companies(line)
    total = pr.get("commits") if isinstance(pr, dict) else None
    if not isinstance(total, int) or isinstance(total, bool) or total < 0:
        raise ReadError("PR commit count is malformed")
    records = api(f"repos/{WHERE}/pulls/{PR}/commits?per_page=100", paginate=True, query=".[] | @json")
    read = 0
    for line in records.splitlines():
        if not line.strip():
            continue
        commit = document(line)
        message = commit.get("commit", {}).get("message") if isinstance(commit, dict) else None
        parents = commit.get("parents", []) if isinstance(commit, dict) else None
        if not isinstance(message, str) or not isinstance(parents, list):
            raise ReadError("PR commit metadata is malformed")
        read += 1
        if len(parents) > 1:
            continue
        found = set()
        for trailer in re.findall(r"^co-authored-by:(.*)$", message, re.I | re.M):
            found |= ai_companies(trailer)
        if any("anthropic" in ai_companies(value)
               for value in re.findall(r"^orchestrated-by:(.*)$", message, re.I | re.M)):
            orchestrated += 1
            found.discard("anthropic")
        companies |= found
    # GitHub lists at most 250 commits of a pull request; an unread commit could hide an AI writer.
    if total > read:
        raise Hold(f"PR has {total} commits but only {read} could be read; an unread commit "
                   "could hide an AI co-author")
    return companies, orchestrated


DIRECTION = "Orchestrator edits within the writer's direction:"
# Set by check() for an open PR: one writer company per PR (#698). Merged PRs keep the rule they
# merged under, and raw input cannot read commits.
ONE_WRITER = False


def writer_companies(authors, body, hidden, reviewer, matched):
    """The writer companies of an approval: its authors' vendors, plus the PR's hidden writers when
    an ops author is named or the one-writer rule applies (#698). Holds with `matched` when the
    reviewer's company is a writer's, then when the PR has more than one writer company."""
    # An ops author with no vendor (a person or script, `ops:<name>/agent:writer`) has no company.
    ops = [name for name in authors if name.startswith("ops:") and name.endswith("/agent:writer")]
    writers = {vendor_company(name) for name in authors if name not in ops}
    judged = writers
    if ops or ONE_WRITER:
        companies, orchestrated = hidden()
        writers |= companies
        judged = set(writers)
        if not ONE_WRITER:
            if orchestrated:
                judged.add("anthropic")
        else:
            # The reviewer judges the orchestrator's edits (#698): `no` makes Anthropic a writer,
            # so a Claude review holds and another company reviews.
            found = [line for line in identity_lines(body) if line.startswith(DIRECTION)]
            if len(found) > 1 or (found and not re.fullmatch(re.escape(DIRECTION) + r"[ \t]*(yes|no)[ \t]*", found[0])):
                raise Hold(f"approval needs at most one visible '{DIRECTION} yes|no' line")
            if orchestrated and not found:
                raise Hold(f"PR has orchestrator commits; the approval needs one '{DIRECTION} yes|no' line")
            if found and found[0].split(":", 1)[1].strip(" \t") == "no":
                judged.add("anthropic")
    if reviewer in judged:
        raise Hold(matched)
    if ONE_WRITER and len(writers) > 1:
        raise Hold("PR has more than one writer company (" + ", ".join(sorted(writers))
                   + "): one writer company per PR (#698)")
    return judged


def vendor_rule(body, hidden=lambda: (set(), 0)):
    """With the policy on, the reviewer's company must differ from every author's company."""
    values = {}
    for field in ("Author agents:", "Reviewer agent:"):
        line = next(line for line in identity_lines(body) if line.startswith(field))
        values[field] = line[len(field):].strip(" \t")
    names = [name.strip(" ") for name in values["Author agents:"].split(",")]
    writer_companies(names, body, hidden, vendor_company(values["Reviewer agent:"]),
                     "reviewer vendor matches a writer vendor")


def remediation(body):
    """The visible `Remediates:` lines must be distinct full shas and name the requested one."""
    named = []
    for line in identity_lines(body):
        if not line.startswith("Remediates:"):
            continue
        value = line[len("Remediates:"):].strip(" \t")
        if not sha(value):
            raise Hold("approval has a malformed Remediates line")
        named.append(value)
    if len(set(named)) != len(named):
        raise Hold("approval repeats a Remediates line")
    if REMEDIATES not in named:
        raise Hold("latest approval has no visible Remediates line naming the requested commit")


def gate_approval(body, hidden):
    """Return the attested reviewer ID, company and writer companies for a gate review."""
    if body.startswith(HUMAN):
        # A write collaborator's formal APPROVE: company `human`, never a writer's company.
        return "human:" + body[len(HUMAN):], "human", set(), False
    if not identity(body):
        raise Hold("gate approval lacks required canonical independent-agent fields")
    lines = identity_lines(body)
    for field, value in (("Owner guards:", "(unchanged|loosened)"), ("Stop:", "nothing"),
                         ("Expenditure:", EXPENDITURE)):
        found = [line for line in lines if line.startswith(field)]
        if len(found) != 1 or not re.fullmatch(re.escape(field) + r"[ \t]*" + value + r"[ \t]*", found[0]):
            raise Hold(f"gate approval needs exactly one visible '{field} {value}' line")
    loosened = "loosened" in next(line for line in lines if line.startswith("Owner guards:"))
    author_line = next(line for line in lines if line.startswith("Author agents:"))
    reviewer_line = next(line for line in lines if line.startswith("Reviewer agent:"))
    authors = [name.strip(" \t") for name in author_line[len("Author agents:"):].split(",")]
    reviewer_id = reviewer_line[len("Reviewer agent:"):].strip(" \t")
    # As in vendor_rule: an ops author has no company, but its hidden AI writers count.
    ops = [name for name in authors if name.startswith("ops:") and name.endswith("/agent:writer")]
    if (not reviewer_id.split("/agent:", 1)[1].startswith("reviewer/")
            or any(not name.split("/agent:", 1)[1].startswith("writer/") for name in authors if name not in ops)):
        raise UnknownVendor("gate approval does not name a known reviewer or writer vendor")
    company = vendor_company(reviewer_id)
    writers = writer_companies(authors, body, hidden, company, "gate reviewer vendor matches a writer vendor")
    return reviewer_id, company, writers, loosened


def gate_reviewers(events, full_head, hidden):
    """Only authenticated, mature events reach here in production; raw fixtures use record order."""
    latest = max(event[0] for event in events)
    for event in events:
        if event[0] == latest:
            if event[1] or not event[2]:
                raise Hold(event[1] or "latest approval lacks canonical independent-agent fields")
            gate_approval(event[3], hidden)
    two = GATE == "2"
    barriers = [event[0] for event in events if event[4] != "APPROVE"]
    barrier = max(barriers) if barriers else None
    candidates = []
    for event in sorted(events, key=lambda event: event[0]):
        when, reason, canonical, body, verdict, repository_reviewer, reviewed = event
        if (verdict != "APPROVE" or reason or not canonical or reviewed != full_head
                or (barrier is not None and when <= barrier)):
            continue
        try:
            reviewer_id, company, writers, loosened = gate_approval(body, hidden)
        except UnknownVendor:
            raise
        except Hold:
            continue
        candidates.append((reviewer_id, company, writers, repository_reviewer))
        two = two or loosened
    if not two and candidates:
        reviewer_id, _, _, repository_reviewer = candidates[-1]
        print(f"ROH-GATE reviewers={reviewer_id}")
        return {repository_reviewer} if repository_reviewer is not None else set()
    for index, (reviewer_id, company, writers, repository_reviewer) in enumerate(candidates):
        for other_id, other_company, other_writers, other_reviewer in candidates[:index]:
            all_writers = writers | other_writers
            if company != other_company and company not in all_writers and other_company not in all_writers:
                print(f"ROH-GATE reviewers={other_id},{reviewer_id}")
                return {value for value in (other_reviewer, repository_reviewer) if value is not None}
    if not two:
        raise Hold("gate needs an exact-head APPROVE from a company independent of every writer "
                   "after the latest rejection or ambiguity")
    raise Hold("two-review needs two exact-head APPROVEs from distinct companies independent of every "
               "writer after the latest rejection or ambiguity")


def lexical(comment, directory):
    path = Path(directory) / "comment"
    path.write_text(comment + "\x1e", encoding="utf-8")
    path.chmod(0o600)
    environment = {**os.environ, "REVIEW_ON_HEAD_COMMENTS": str(path),
                   "REVIEW_ON_HEAD_REQUIRE_PROVENANCE": "0", "_REVIEW_ON_HEAD_LEXICAL": "1"}
    command = ["sh", SCRIPT, PR, HEAD, "--repo", WHERE]
    if AUTO == "1":
        command.append("--auto-merge")
    try:
        result = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        raise ReadError("lexical review parser could not run") from None
    if result.returncode:
        raise ReadError("lexical review parser failed")
    record = result.stdout.strip("\n")
    if not record:
        return None
    fields = record.split("\t")
    if len(fields) != 3 or fields[0] not in {"APPROVE", "REQUEST CHANGES", "AMBIGUOUS"}:
        raise ReadError("lexical review parser returned an invalid record")
    return fields


def raw_gate():
    """Test/trusted-wrapper input only; it cannot bypass forced production provenance."""
    try:
        bodies = Path(os.environ["REVIEW_ON_HEAD_COMMENTS"]).read_bytes().decode("utf-8").split("\x1e")
    except (OSError, UnicodeDecodeError):
        raise ReadError("raw review comments could not be read") from None
    events = []
    with tempfile.TemporaryDirectory(prefix="ai-sdlc-review-") as directory:
        for order, body in enumerate(bodies):
            parsed = lexical(body, directory)
            if parsed is None:
                continue
            verdict, reviewed, attests = parsed
            reason, canonical = None, False
            if verdict != "APPROVE":
                reason = "latest review is a rejection or ambiguous record"
            else:
                try:
                    canonical = identity(body)
                    if REMEDIATES:
                        remediation(body)
                except Hold as error:
                    reason = str(error)
                if attests != "attests":
                    reason = "approval does not attest Stop: nothing and matching Expenditure"
            events.append((order, reason, canonical, body, verdict, None, reviewed))
    if not events:
        raise Hold("no review names the requested current head")

    def no_commits():
        # Raw input has no PR to read commits from, so an ops author's hidden writers stay unknown.
        raise Hold("raw review input cannot read an ops author's commits")
    gate_reviewers(events, HEAD, no_commits)


def check():
    query = '.[] | @json'
    records = api(f"repos/{WHERE}/issues/{PR}/comments?per_page=100", paginate=True, query=query)
    comments = [document(line) for line in records.splitlines() if line.strip()]
    reviews = []
    if not REMEDIATES:
        records = api(f"repos/{WHERE}/pulls/{PR}/reviews?per_page=100", paginate=True, query=query)
        reviews = [document(line) for line in records.splitlines() if line.strip()]
    # This server observation follows evidence acquisition and is pinned to the requested head.
    pr, observed, cutoff = observe()
    full_head = pr["head"]["sha"]
    global ONE_WRITER
    ONE_WRITER = cutoff is None
    hidden_cache = []

    def writers_hidden():
        if not hidden_cache:
            hidden_cache.append(hidden_writers(pr))
        return hidden_cache[0]
    started = policy_start()
    vendor_policy = cutoff is None or (started is not None and cutoff >= started)
    events = []
    excluded = False
    checked_permission = False
    with tempfile.TemporaryDirectory(prefix="ai-sdlc-review-") as directory:
        for comment in comments:
            if not isinstance(comment, dict):
                raise ReadError("comment metadata is malformed")
            if reviewer(comment) is None:
                continue
            body = comment.get("body")
            if not isinstance(body, str):
                raise ReadError("comment body is malformed")
            if not any(marker in body for marker in ("VERDICT:", "**Verdict:**", "Reviewed head:")):
                continue
            # Ignore records for other heads before asking for repository access.
            if "\x1e" in body or "\0" in body:
                if permission(comment) is not None:
                    raise Hold("trusted comment contains an ambiguous review record separator")
                continue
            parsed = lexical(body, directory)
            if parsed is None:
                continue
            repository_reviewer = permission(comment)
            checked_permission = True
            if repository_reviewer is None:
                continue
            verdict, reviewed, attests = parsed
            created, updated = instant(comment.get("created_at")), instant(comment.get("updated_at"))
            if created > updated:
                raise Hold("review edit timestamp precedes creation")
            if updated > observed:
                raise Hold("review timestamp is later than the trusted server observation")
            reason, canonical = None, False
            if verdict != "APPROVE":
                reason = "latest trusted review is a rejection or ambiguous record"
            else:
                if vendor_policy:
                    try:
                        canonical = identity(body)
                        if not canonical:
                            raise Hold("the Reviewer vendor rule needs the independent-agent fields")
                        vendor_rule(body, writers_hidden)
                    except Hold as error:
                        reason = str(error)
                elif GATE != "0":
                    try:
                        canonical = identity(body)
                    except Hold as error:
                        reason = str(error)
                # Malformed policy- or gate-required fields hold even on a retrospective assessment.
                if reason is None and cutoff is not None and updated >= cutoff:
                    excluded = True
                    continue
                if reason is None and AUTO == "1" and attests != "attests":
                    reason = "latest approval does not attest Stop: nothing and matching Expenditure"
                if reason is None and REMEDIATES:
                    try:
                        remediation(body)
                    except Hold as error:
                        reason = str(error)
            events.append((updated, reason, canonical, body, verdict, repository_reviewer, reviewed))
    # Formal reviews: the pinned bot signature (plain path only) and, on every path, a person's
    # formal review by a write, maintain or admin collaborator (owner, 25 Oct 2026). Bodies are never parsed.
    author = pr.get("user")
    author_login = author.get("login") if isinstance(author, dict) else None
    if isinstance(author_login, str) and author_login and author_login != "eugnel-bot":
        for review in reviews:
            if not isinstance(review, dict):
                raise ReadError("formal review metadata is malformed")
            who = reviewer(review)
            human = None
            if who != ("eugnel-bot", 346810768):
                # A person only: a Bot login with write access must not fill the human slot.
                if (who is None or who[0] == "eugnel-bot" or review["user"].get("type") != "User"
                        or who[0].casefold() == author_login.casefold()
                        or review.get("state") not in ("APPROVED", "CHANGES_REQUESTED")
                        or review.get("commit_id") != full_head):
                    continue
                human = who[0]
            elif AUTO == "1":
                continue
            state = review.get("state")
            if state not in ("APPROVED", "CHANGES_REQUESTED") or review.get("commit_id") != full_head:
                continue
            repository_reviewer = permission(review)
            checked_permission = True
            if repository_reviewer is None:
                continue
            submitted = instant(review.get("submitted_at"))
            # As for comments: an approval must predate merge; a later objection still holds.
            if cutoff is not None and submitted >= cutoff and state == "APPROVED":
                excluded = True
                continue
            if submitted > observed:
                raise Hold("review timestamp is later than the trusted server observation")
            reason = "latest trusted review is a rejection or ambiguous record" if state == "CHANGES_REQUESTED" else None
            # The owner-authorised signature needs no comment identity fields.
            events.append((submitted, reason, True, HUMAN + human if human else "",
                           "APPROVE" if reason is None else "REQUEST CHANGES", repository_reviewer, full_head))
    if checked_permission and cutoff is None:
        pr_after, observed_after, cutoff_after = observe()
        if cutoff_after is not None or pr_after["head"]["sha"] != full_head:
            raise Hold("pull request changed while collaborator permission was checked")
        # Keep the first server second for maturity; a later permission read cannot mature it.
    if not events:
        raise Hold("no eligible premerge approval; a posted/edited-after-merge approval is retrospective" if excluded
                   else "no review names the requested current head")
    # #698: a person's formal review reads no author fields, so check the commits' writers here too.
    if ONE_WRITER and len(writers_hidden()[0]) > 1:
        raise Hold("PR has more than one writer company (" + ", ".join(sorted(writers_hidden()[0]))
                   + "): one writer company per PR (#698)")
    latest = max(event[0] for event in events)
    current = [event for event in events if event[0] == latest]
    people = {value for _, _, _, _, _, value, _ in current if value is not None}
    roles = "; ".join(f"reviewer {login}: {role}" for login, role in sorted(people))
    for _, reason, _, _, _, _, _ in current:
        if reason:
            raise Hold(f"{reason} ({roles})")
    if cutoff is None and latest == observed:
        return 3
    try:
        people |= gate_reviewers(events, full_head, writers_hidden) if GATE != "0" else set()
    except Hold as error:
        raise Hold(f"{error} ({roles})") from None
    roles = "; ".join(f"reviewer {login}: {role}" for login, role in sorted(people))
    print(f"REVIEW-ON-HEAD OK: latest eligible exact-head review is an APPROVE ({roles})")
    return 0


try:
    if TIER == "1":
        classify()
        sys.exit(0)
    if (GATE != "0" and os.environ.get("REVIEW_ON_HEAD_COMMENTS")
            and os.environ.get("REVIEW_ON_HEAD_REQUIRE_PROVENANCE") != "1"):
        raw_gate()
        sys.exit(0)
    for attempt in range(2):
        outcome = check()
        if outcome != 3:
            sys.exit(outcome)
        if attempt == 0:
            try:
                subprocess.run(["sleep", "1"], check=True, timeout=2)
            except (OSError, subprocess.SubprocessError):
                raise ReadError("bounded review-maturity retry could not run") from None
    raise Hold("approval is not older than the trusted server second; retry after it matures")
except Hold as error:
    print("REVIEW-ON-HEAD FAIL: " + str(error))
    sys.exit(1)
except ReadError as error:
    print("REVIEW-ON-HEAD RECORD ERROR: " + str(error), file=sys.stderr)
    sys.exit(2)
PROVENANCE
  exit $?
fi

if [ -n "${REVIEW_ON_HEAD_COMMENTS:-}" ]; then
  bodies=$(cat "$REVIEW_ON_HEAD_COMMENTS" && printf x) || exit 2
else
  echo "REVIEW-ON-HEAD RECORD ERROR: raw review comments are missing" >&2; exit 2
fi
bodies=${bodies%x}

# One record per comment. A review is the verdict on the first non-blank line and the head on the
# second. Any other line at column 0 that starts with `VERDICT:`, `**Verdict:**` or `Reviewed head:`
# is a stray line, a verdict on top with no head under it included. A comment with a stray line holds
# this head when it names this head, or names no head at all; one whose named heads are all other
# heads is left alone. The latest well-formed review of this head decides otherwise.
#
# `Remediates:` lines (--remediates only) are read from visible lines alone, as identity_lines() in
# the provenance path does: scan() skips fenced, `>`-quoted and indented lines and blanks HTML
# comments; an unclosed fence or comment, or a backtick fence with a backtick in its info string,
# holds. Every visible `Remediates:` line must carry a distinct 40-hex sha and one must be the sha asked for.
parse_rc=0
latest=$(printf '%s' "$bodies" | HEAD_SHA="$sha" EXPECT_EXPENDITURE="$expect_expenditure" REMEDIATES="$remediates" AUTO_MODE="$auto" awk 'BEGIN { RS = "\036"; FS = "\n" }
  function clean_head(l) { sub(/^Reviewed head:[[:space:]]*`?/, "", l); sub(/`?[[:space:]]*$/, "", l); return l }
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
  {
    verdict = ""; head = ""; seen = 0; stray = 0; mentions = 0; other = 0
    stops = 0; stop_ok = 0; spends = 0; spend_ok = 0
    fence_len = 0; fence_ch = ""; cmt = 0; amb = 0; rem_bad = 0; rem_hit = 0; split("", seen_rem)
    for (i = 1; i <= NF; i++) {
      line = $i; sub(/\r$/, "", line)
      scan(line)
      if (vis_ok && vis ~ /^Remediates:/) {
        v = vis; sub(/^Remediates:/, "", v); sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
        if (v !~ /^[0123456789abcdef]+$/ || length(v) != 40) rem_bad = 1
        else {
          if (v in seen_rem) rem_bad = 1
          seen_rem[v] = 1
          if (v == ENVIRON["REMEDIATES"]) rem_hit = 1
        }
      }
      if (line ~ /^Stop:/) { stops++; if (line ~ /^Stop:[ \t]*nothing[ \t]*$/) stop_ok = 1 }
      if (line ~ /^Expenditure:/) {
        spends++
        if (line ~ /^Expenditure:[ \t]*(none|approved)[ \t]*$/) {
          value = line; sub(/^Expenditure:[ \t]*/, "", value); sub(/[ \t]*$/, "", value)
          if (value == ENVIRON["EXPECT_EXPENDITURE"]) spend_ok = 1
        }
      }
      if (line ~ /^[[:space:]]*$/ && seen < 2) continue
      is_verdict = (line ~ /^(VERDICT:|\*\*Verdict:\*\*)[[:space:]]*(APPROVE|REQUEST CHANGES)[[:space:]]*$/)
      is_head = (line ~ /^Reviewed head:[[:space:]]*`?[0-9a-f]+`?[[:space:]]*$/)
      if (seen == 0) {
        seen = (is_verdict) ? 1 : 2
        if (is_verdict) { verdict = (line ~ /APPROVE/) ? "APPROVE" : "REQUEST CHANGES"; continue }
      } else if (seen == 1) {
        seen = 2
        if (is_head) { h = clean_head(line); if (length(h) >= 12 && length(h) <= 40) { head = h; continue } }
        stray = 1
      }
      if (line ~ /^(VERDICT:|\*\*Verdict:\*\*|Reviewed head:)/) {
        stray = 1
        if (is_head) {
          h = clean_head(line)
          if (length(h) >= 12 && length(h) <= 40) { if (index(ENVIRON["HEAD_SHA"], h) == 1) mentions = 1; else other = 1 }
        }
      }
    }
    if (seen == 1) stray = 1   # a verdict with nothing under it
    stop_spend = (stops == 1 && stop_ok && spends == 1 && spend_ok)
    rem_ok = (!amb && fence_len == 0 && !cmt && !rem_bad && rem_hit)
    attests = ((ENVIRON["AUTO_MODE"] != "1" || stop_spend) && (ENVIRON["REMEDIATES"] == "" || rem_ok)) ? "attests" : "holds"
    if (head != "") {
      if (index(ENVIRON["HEAD_SHA"], head) == 1) { last = stray ? "AMBIGUOUS" : verdict; last_head = head; last_attest = attests }
      else if (mentions) { last = "AMBIGUOUS"; last_head = ENVIRON["HEAD_SHA"]; last_attest = "holds" }
    } else if (stray && (mentions || !other)) {
      last = "AMBIGUOUS"; last_head = ENVIRON["HEAD_SHA"]; last_attest = "holds"
    }
  }
  END { if (last != "") print last "\t" last_head "\t" last_attest }') || parse_rc=$?
[ "$parse_rc" -eq 0 ] || { echo "REVIEW-ON-HEAD RECORD ERROR: could not parse the comments of #$pr (awk exit $parse_rc)" >&2; exit 2; }
if [ "${_REVIEW_ON_HEAD_LEXICAL:-0}" = 1 ]; then
  printf '%s\n' "$latest"
  exit 0
fi
attest=${latest##*	}
latest=${latest%	*}

case "$latest" in
  "APPROVE	"*)
    if [ "$attest" != attests ] && [ -z "$remediates" ]; then
      echo "REVIEW-ON-HEAD FAIL: the latest APPROVE of head ${latest#*	} does not say both 'Stop: nothing' and 'Expenditure: $expect_expenditure' (one line each); it holds."
      exit 1
    fi
    if [ "$attest" != attests ]; then
      echo "REVIEW-ON-HEAD FAIL: the latest APPROVE of head ${latest#*	} does not carry what was asked: a visible 'Remediates: $remediates' line (every Remediates line a distinct full sha)$([ "$auto" = 1 ] && echo " and 'Stop: nothing' with 'Expenditure: $expect_expenditure'"); it holds."
      exit 1
    fi
    echo "REVIEW-ON-HEAD OK: the latest review of head ${latest#*	} is an APPROVE"; exit 0 ;;
  "REQUEST CHANGES	"*) echo "REVIEW-ON-HEAD FAIL: the latest review of head ${latest#*	} is a REQUEST CHANGES. Fix, push and get a re-review of the new head."; exit 1 ;;
  "AMBIGUOUS	"*) echo "REVIEW-ON-HEAD FAIL: the latest review of head ${latest#*	} carries a VERDICT or Reviewed head line outside the two lines on top. Post one review with the two lines on top; quote earlier reviews with '> '."; exit 1 ;;
esac
echo "REVIEW-ON-HEAD FAIL: no review names head ${sha}. Get a review of the current head before merging."
exit 1
