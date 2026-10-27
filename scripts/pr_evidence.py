"""Trusted API adapter for the unchanged, hash-pinned AI-SDLC helpers.

Run from trusted main, never from a pull-request checkout on a persistent runner.
"""
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPO = "eugnel-ltd/RealTimeTranslation"
CHECKS = ",".join((
    "checks / owner-decisions.md is append-only",
    "checks / A fix leaves its failing test alone",
    "checks / No credentials in the PR range",
    "checks / product.yaml is valid and a published product has its baseline",
    "checks / Cloudflare config stays inside the US$5 plan",
    "test",
))


class Hold(Exception):
    """An unmet condition: no merge or deployment is permitted."""


class Failure(Exception):
    """Evidence could not be obtained or parsed; fail closed."""


def command(args, *, env=None, timeout=60):
    try:
        return subprocess.run(args, cwd=ROOT, env=env, text=True, capture_output=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as error:
        raise Failure("command could not complete") from error


def api(endpoint, *, pages=False):
    args = ["gh", "api", endpoint]
    if pages:
        args.extend(("--paginate", "--slurp"))
    result = command(args)
    if result.returncode:
        raise Failure("GitHub API read failed")
    try:
        value = json.loads(result.stdout)
    except (ValueError, TypeError) as error:
        raise Failure("GitHub API response is not JSON") from error
    if pages:
        if not isinstance(value, list) or not all(isinstance(page, list) for page in value):
            raise Failure("GitHub API pagination shape is invalid")
        return [item for page in value for item in page]
    return value


def sha(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise Failure("expected a complete lowercase commit SHA")
    return value


def number(value):
    if type(value) is not int or value <= 0:
        raise Failure("expected a positive PR number")
    return value


def helper(name, args, env):
    result = command(["sh", str(ROOT / ".ai-sdlc" / name), *args], env=env)
    if result.returncode == 1:
        # Upstream messages include only controlled identifiers/check names; API error
        # payloads are never forwarded by this adapter.
        raise Hold("required APPROVE or checks are not green")
    if result.returncode:
        raise Failure("adopted evidence helper failed")
    return result.stdout


def check_pr(pr, head, expenditure):
    env = dict(os.environ, REQUIRED_CHECKS=CHECKS, EXPECT_EXPENDITURE=expenditure,
               REVIEW_JOB="checks / Independent APPROVE names the head")
    helper("review_on_head.sh", [str(number(pr)), sha(head), "--repo", REPO, "--auto-merge"], env)
    helper("head_checks.sh", [REPO, str(pr), head], env)


def check_merge(commit, proved=()):
    matches = api(f"repos/{REPO}/commits/{sha(commit)}/pulls")
    if not isinstance(matches, list):
        raise Failure("merged-PR response shape is invalid")
    matches = [item for item in matches if isinstance(item, dict) and item.get("state") == "closed"
               and item.get("merged_at") and item.get("base", {}).get("ref") == "main"
               and item.get("merge_commit_sha") == commit]
    if len(matches) != 1:
        raise Hold("expected exactly one closed merged PR for the main commit")
    pr = matches[0]
    number(pr.get("number"))
    if not isinstance(pr.get("head"), dict) or pr["head"].get("repo", {}).get("full_name") != REPO:
        raise Hold("merged PR does not have a same-repository head")
    sha(pr["head"].get("sha"))
    env = os.environ.copy()
    env.pop("REQUIRED_CHECKS", None)
    env.pop("RELEASE_REQUIRED_CHECKS", None)
    result = command(["sh", str(ROOT / ".ai-sdlc/release_evidence.sh"), REPO, commit, "--base", "main"], env=env)
    if result.returncode not in (0, 1):
        raise Failure("adopted release evidence helper failed")
    lines = result.stdout.strip().splitlines()
    if not lines:
        raise Failure("release evidence helper returned no evidence line")
    evidence = lines[-1]
    if result.returncode == 0:
        print(evidence)
        return
    if proved:
        remediation = command(["sh", str(ROOT / ".ai-sdlc/release_remediation.sh"),
                               REPO, commit, *proved, "--base", "main"], env=env)
        if remediation.returncode == 0:
            lines = remediation.stdout.strip().splitlines()
            if not lines:
                raise Failure("release remediation helper returned no evidence line")
            print(lines[-1])
            return
        if remediation.returncode != 1:
            raise Failure("adopted release remediation helper failed")
    raise Hold(evidence)
