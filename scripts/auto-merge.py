#!/usr/bin/env python3
"""Apply the upstream merge rule, with public-repository comment authentication."""
import argparse
import re
import sys

sys.dont_write_bytecode = True
from pr_evidence import Failure, Hold, REPO, api, check_pr, command, number, sha


def merge_all(dry_run):
    prs = api(f"repos/{REPO}/pulls?state=open&per_page=100", pages=True)
    if not all(isinstance(pr, dict) for pr in prs):
        raise Failure("open PR list shape is invalid")
    merged = False
    failure = None
    try:
        for entry in prs:
            pr = number(entry.get("number"))
            info = api(f"repos/{REPO}/pulls/{pr}")
            if not isinstance(info, dict):
                raise Failure("PR shape is invalid")
            head = info.get("head")
            base = info.get("base")
            if not isinstance(head, dict) or not isinstance(base, dict):
                raise Failure("PR refs are missing")
            current = sha(head.get("sha"))
            if info.get("state") != "open" or head.get("repo", {}).get("full_name") != REPO or base.get("ref") != "main":
                print(f"AUTO-MERGE SKIP #{pr}: not an open same-repository PR into main")
                continue
            body = info.get("body") or ""
            if not isinstance(body, str):
                raise Failure("PR body shape is invalid")
            if re.search(r"^- Expenditure: none\s*$", body, re.MULTILINE):
                expenditure = "none"
            elif re.search(r"^- Expenditure: approved [0-9]{4}-[0-9]{2}-[0-9]{2}( .*)?$", body, re.MULTILINE):
                expenditure = "approved"
            else:
                print(f"AUTO-MERGE SKIP #{pr}: expenditure declaration holds")
                continue
            try:
                check_pr(pr, current, expenditure)
            except Hold:
                print(f"AUTO-MERGE SKIP #{pr}: latest trusted review or exact-head checks hold")
                continue
            if dry_run:
                print(f"AUTO-MERGE READY #{pr} {current}")
                continue
            if info.get("draft") is True:
                if command(["gh", "pr", "ready", str(pr), "--repo", REPO]).returncode:
                    raise Failure("could not mark approved draft ready")
            if command(["gh", "pr", "merge", str(pr), "--repo", REPO, "--squash", "--match-head-commit", current]).returncode:
                raise Failure("pinned squash merge failed")
            merged = True
            print(f"AUTO-MERGE OK #{pr} {current}")
    except Failure as error:
        failure = error
    finally:
        if merged:
            # github.token merges emit no normal push workflow. Dispatch an existing,
            # local default-branch, deploy-free workflow even if a later PR read failed.
            result = command(["gh", "api", "--method", "POST", f"repos/{REPO}/actions/workflows/web-release-check.yml/dispatches", "-f", "ref=main"])
            if result.returncode:
                failure = Failure("merged, but release-check dispatch failed")
            else:
                print("AUTO-MERGE dispatched web-release-check.yml on main")
    if failure:
        raise failure


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        merge_all(args.dry_run)
        return 0
    except Failure as error:
        print(f"AUTO-MERGE ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
