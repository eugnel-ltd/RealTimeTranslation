#!/usr/bin/env python3
"""Preflight a reviewed Worker release; --apply deploys only from isolated cloud."""
import argparse
import json
import os
import re
import sys
import uuid

sys.dont_write_bytecode = True
from pr_evidence import Failure, Hold, ROOT, check_merge, command, sha

LEDGER = "docs/autonomy-ledger.md"
GREEN = re.compile(r"^Enforcement status: `?green since [0-9]{4}-[0-9]{2}-[0-9]{2}(?:`|\s|$)", re.MULTILINE)
UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")


def git(*args):
    result = command(["git", *args])
    if result.returncode:
        raise Failure("git evidence read failed")
    return result.stdout.strip()


def ledger_at(commit):
    entry = git("ls-tree", commit, "--", LEDGER)
    if not entry:
        return ""
    return git("show", f"{commit}:{LEDGER}")


def preflight(commit, evidence_only=False):
    sha(commit)
    if git("status", "--porcelain", "--untracked-files=all"):
        raise Hold("release needs a clean worktree")
    git("fetch", "-q", "origin", "main")
    if git("rev-parse", "HEAD") != commit or git("rev-parse", "origin/main") != commit:
        raise Hold("release must check out the exact current origin/main commit")
    ledger = ledger_at(commit)
    levels = re.findall(r"^\|\s*release\s*\|\s*([0-9]+)\s*\|", ledger, re.MULTILINE)
    if len(levels) != 1 or int(levels[0]) < 3:
        raise Hold("release ledger level is below 3 or ambiguous")
    if not GREEN.search(ledger):
        raise Hold("enforcement ledger is not green")
    current = commit
    proved = []
    while GREEN.search(ledger_at(current)):
        check_merge(current, proved)
        proved.append(current)
        parents = git("rev-list", "--parents", "-n", "1", current).split()
        if len(parents) < 2:
            raise Hold("ledger is green back to root; no transition is established")
        current = sha(parents[1])
    print(f"WEB RELEASE EVIDENCE OK {commit}: {len(proved)} green-chain commits")
    if not evidence_only:
        result = command([sys.executable, str(ROOT / ".ai-sdlc/manifest_check.py"), "product.yaml", "--publishing", "web"])
        print(result.stdout, end="")
        if result.returncode == 1:
            raise Hold("publishing-web baseline is incomplete")
        if result.returncode:
            raise Failure("publishing-web baseline checker failed")
    return len(proved)


def deployment():
    result = command(["npx", "--no-install", "wrangler", "deployments", "list", "--name", "rtt", "--json"])
    if result.returncode:
        raise Failure("cannot read active Worker deployment")
    try:
        entries = json.loads(result.stdout)
        if not isinstance(entries, list) or not entries:
            raise ValueError("no deployment")
        latest = max(entries, key=lambda item: item["created_on"])
        versions = latest["versions"]
        if len(versions) != 1 or versions[0]["percentage"] != 100:
            raise ValueError("split deployment")
        identity, version = latest["id"], versions[0]["version_id"]
        if not UUID.fullmatch(identity) or not UUID.fullmatch(version):
            raise ValueError("invalid deployment identity")
        return identity, version
    except (ValueError, TypeError, KeyError, IndexError) as error:
        raise Failure("active Worker deployment/rollback target is ambiguous") from error


def attribute(active, attempt, commit):
    """A changed deployment is ours only when its immutable version says so."""
    _, version = active
    try:
        result = command(["npx", "--no-install", "wrangler", "versions", "view", version, "--name", "rtt", "--json"])
        if result.returncode:
            raise ValueError("version read failed")
        record = json.loads(result.stdout)
        annotations = record["annotations"]
        if record["id"] != version or annotations["workers/tag"] != attempt or annotations["workers/message"] != f"RTT source {commit}":
            raise ValueError("another release attempt")
    except (Failure, ValueError, TypeError, KeyError) as error:
        raise Failure("deployment UNKNOWN; active version is not proved to belong to this attempt") from error


def still_current(owned):
    try:
        current = deployment()
    except Failure as error:
        raise Failure("deployment UNKNOWN; active identity cannot be freshly verified") from error
    if current != owned:
        raise Failure("deployment UNKNOWN; an intervening release changed the active identity")


def recover(previous_version, owned):
    # Cloudflare exposes no atomic compare-and-swap rollback. This read prevents
    # undoing an already observed intervening release; operators must coordinate
    # the remaining read/write interval rather than assume it is atomic.
    still_current(owned)
    rollback(previous_version)


def apply(commit):
    if os.environ.get("GITHUB_ACTIONS") == "true":
        raise Hold("apply runs in isolated cloud, never on the public repository self-hosted runner")
    required = ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "RTT_UPTIME_ACCESS_CLIENT_ID", "RTT_UPTIME_ACCESS_CLIENT_SECRET")
    if any(not os.environ.get(name, "").strip() for name in required):
        raise Hold("existing Cloudflare and Access capabilities must be configured before apply")
    if command(["npm", "run", "build"], timeout=300).returncode:
        raise Hold("release build failed")
    attempt = f"rtt-{uuid.uuid4().hex}"
    deploy = ["npx", "--no-install", "wrangler", "deploy", "--var", f"DEPLOYMENT_SHA:{commit}",
              "--tag", attempt, "--message", f"RTT source {commit}"]
    if command([*deploy, "--dry-run"], timeout=300).returncode:
        raise Hold("Worker dry deployment failed")
    previous_id, previous_version = deployment()
    # Recheck the immutable checkout and main after building, before the first write.
    preflight(commit)
    print(f"WEB RELEASE SUBMITTING {commit}; attempt {attempt}; rollback version {previous_version}", flush=True)
    try:
        deployed = command(deploy, timeout=300)
    except Failure:
        deployed = None
    if deployed is None or deployed.returncode:
        # A lost deploy response is unknown, never an invented failure/no-op. Read
        # provider state first, and roll back only a concretely changed deployment.
        try:
            active = deployment()
        except Failure as error:
            raise Failure("deployment UNKNOWN; reconcile provider state before retry") from error
        if active[0] == previous_id:
            raise Hold("deployment command failed; previous deployment remains active")
        attribute(active, attempt, commit)
        recover(previous_version, active)
        raise Hold("deployment command failed after changing active deployment; rollback attempted")
    active_id, active_version = deployment()
    if active_id == previous_id:
        raise Failure("deployment receipt UNKNOWN; active deployment did not change")
    owned = (active_id, active_version)
    attribute(owned, attempt, commit)
    try:
        version = json.loads((ROOT / "package.json").read_text())["version"]
        if not isinstance(version, str) or not version:
            raise ValueError("invalid package version")
    except (OSError, ValueError, KeyError) as error:
        recover(previous_version, owned)
        raise Failure("release package version cannot be read") from error
    try:
        health = command(["node", "--input-type=module", "-e", "import { checkUptime } from './scripts/uptime.mjs'; const r=await checkUptime({expectVersion:process.argv[1]}); console.log(JSON.stringify(r)); process.exitCode=r.exitCode;", f"{version}+{commit}"], timeout=45)
    except Failure as error:
        recover(previous_version, owned)
        raise Hold("authenticated health receipt unavailable; rollback attempted") from error
    if health.returncode:
        recover(previous_version, owned)
        raise Hold("authenticated exact-SHA health failed; rollback attempted")
    try:
        report = json.loads(health.stdout)
        if report.get("healthy") is not True or report.get("exitCode") != 0:
            raise ValueError("unhealthy")
    except (ValueError, AttributeError) as error:
        recover(previous_version, owned)
        raise Hold("health receipt is invalid; rollback attempted") from error
    still_current(owned)
    print(json.dumps({"state": "HEALTH_VERIFIED", "sha": commit, "deployment_id": active_id, "version_id": active_version,
                      "attempt": attempt, "rollback_version": previous_version,
                      "log_check": "pending five-minute tail; release completion not claimed"}))


def rollback(version):
    print(f"WEB RELEASE ROLLING_BACK {version}", flush=True)
    result = command(["npx", "--no-install", "wrangler", "rollback", version, "--name", "rtt", "--yes", "--message", "Guarded RTT release failed health"], timeout=120)
    if result.returncode:
        raise Failure("rollback failed; incident and provider reconciliation required")
    _, active_version = deployment()
    if active_version != version:
        raise Failure("rollback receipt does not confirm the captured version")
    print(f"WEB RELEASE ROLLED_BACK {version}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sha")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--apply", action="store_true")
    group.add_argument("--evidence-only", action="store_true", help="deploy-free GitHub/git evidence; does not claim baseline readiness")
    args = parser.parse_args()
    try:
        preflight(args.sha, args.evidence_only)
        if args.apply:
            apply(args.sha)
        else:
            print("WEB RELEASE PREFLIGHT ONLY; no deployment performed")
        return 0
    except Hold as error:
        print(f"WEB RELEASE HOLD: {error}", file=sys.stderr)
        return 1
    except Failure as error:
        print(f"WEB RELEASE ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
