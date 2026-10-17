#!/usr/bin/env python3
"""Security intake: turn the weekly scanners' reports into intent issues, one per finding.

    security_intake.py --repo owner/name [--root DIR] [--gitleaks JSON] [--osv JSON]
                       [--semgrep JSON] [--file]

Skill `modules/enforcement.md` ("Weekly security scan") owns the rules. Reports, each optional
(a report not given is "not run"):

  gitleaks  `gitleaks detect --no-git --redact --report-format json`: one finding per rule, file
            and line. The issue names the file, the line and the rule, never the matched text.
  osv       `osv-scanner --format json -r .`: one finding per advisory and package version.
  semgrep   `semgrep scan --json`: one finding per rule, listing every location; the issue names
            the rule and the locations, never the matched code.

Without --file the script prints what it would file (a dry run). With --file it opens each new
finding as an issue through `gh api` (REST), skipping any finding whose fingerprint is already on
an issue in the repo, open or closed. Closing an issue as "not planned" with the reason is how a
finding is dismissed: the scan never reopens it. Exit 0 on success, 2 on an unreadable report.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

FINGERPRINT = re.compile(r"<!-- security-fingerprint: ([0-9a-f]{16}) -->")
LABELS = ["intent", "security", "security-finding"]


class Gh:
    """The GitHub calls the intake needs, through `gh api` (REST only: the proxy refuses GraphQL)."""

    def _run(self, args, stdin=None):
        p = subprocess.run(["gh", "api", *args], input=stdin, capture_output=True, text=True)
        if p.returncode != 0:
            raise RuntimeError((p.stderr or p.stdout).strip().splitlines()[-1:] or ["gh failed"])
        return p.stdout

    def fingerprints(self, repo):
        out = self._run(["--paginate", "--jq", ".[] | select(.pull_request == null) | .body // \"\"",
                         f"repos/{repo}/issues?state=all&labels=security-finding&per_page=100"])
        return set(FINGERPRINT.findall(out))

    def create_issue(self, repo, title, body, labels):
        payload = json.dumps({"title": title, "body": body, "labels": labels})
        out = self._run(["--method", "POST", f"repos/{repo}/issues", "--input", "-"], stdin=payload)
        return json.loads(out).get("html_url")


def fingerprint(*parts):
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


def rel(path, root):
    p = str(path or "")
    r = str(root).rstrip("/") + "/"
    if p.startswith(r):
        p = p[len(r):]
    return p[2:] if p.startswith("./") else p


def finding(tool, rule, title, confidence, severity, locations, task_type, detail=""):
    return {"fingerprint": fingerprint(tool, rule, *locations), "tool": tool, "rule": rule,
            "title": title[:120], "confidence": confidence, "severity": severity,
            "locations": locations, "task_type": task_type, "detail": detail}


def from_gitleaks(report, root):
    # Only RuleID, File and StartLine are read: Secret, Match and Line hold the leaked text.
    out = []
    for leak in report or []:
        loc = f"{rel(leak.get('File'), root)}:{leak.get('StartLine')}"
        rule = str(leak.get("RuleID") or "unknown-rule")
        out.append(finding("gitleaks", rule, f"Secret ({rule}) in {loc}", "medium (pattern match; confirm before rotating)",
                           "high", [loc], "bug-fix"))
    return out


def from_osv(report, root):
    out = []
    for result in (report or {}).get("results") or []:
        source = rel((result.get("source") or {}).get("path"), root)
        for pkg in result.get("packages") or []:
            p = pkg.get("package") or {}
            name, version, eco = p.get("name"), p.get("version"), p.get("ecosystem")
            groups = pkg.get("groups") or [{"ids": [v.get("id")]} for v in pkg.get("vulnerabilities") or []]
            summaries = {v.get("id"): v.get("summary") or "" for v in pkg.get("vulnerabilities") or []}
            for g in groups:
                ids = [i for i in g.get("ids") or [] if i]
                if not ids:
                    continue
                vid = sorted(ids)[0]
                f = finding("osv", vid, f"Dependency {name} {version} ({eco}): {vid}", "high (published advisory for this version)",
                            g.get("max_severity") or "unknown", [source], "dependency",
                            detail=f"Advisories: {', '.join(sorted(ids))}. {summaries.get(vid, '')}".strip())
                # Each vulnerable version is its own finding: dismissing one never hides another.
                f["fingerprint"] = fingerprint("osv", ",".join(sorted(ids)), eco, name, version, source)
                out.append(f)
    return out


def from_semgrep(report, root):
    # Only check_id, path, line and the rule's severity and confidence are read: extra.lines and
    # the message can carry the matched code.
    by_rule = {}
    for r in (report or {}).get("results") or []:
        extra = r.get("extra") or {}
        rule = str(r.get("check_id") or "unknown-rule")
        entry = by_rule.setdefault(rule, {"severity": extra.get("severity") or "unknown",
                                          "confidence": (extra.get("metadata") or {}).get("confidence") or "unknown",
                                          "locations": []})
        entry["locations"].append(f"{rel(r.get('path'), root)}:{(r.get('start') or {}).get('line')}")
    out = []
    for rule, e in sorted(by_rule.items()):
        short = rule.rsplit(".", 1)[-1]
        n = len(e["locations"])
        f = finding("semgrep", rule, f"Static analysis: {short} ({n} location{'s' if n != 1 else ''})",
                    str(e["confidence"]).lower(), str(e["severity"]).lower(), sorted(e["locations"]), "bug-fix")
        f["fingerprint"] = fingerprint("semgrep", rule)  # one issue per rule; new locations ride on it
        out.append(f)
    return out


def issue_body(f):
    locs = "\n".join(f"- `{loc}`" for loc in f["locations"])
    detail = f"\n{f['detail']}\n" if f["detail"] else ""
    return f"""## Problem

The weekly security scan (`{f['tool']}`) reports rule `{f['rule']}`.
{detail}
Locations:

{locs}

- Confidence: {f['confidence']}
- Severity: {f['severity']}

The scan names the file, the line and the rule only. Read the location in the repo; never paste the matched text into an issue, PR or log.

## Outcome

Fixed through the normal PR gate (for a secret: rotate it first, then remove it), or dismissed: close this issue as "not planned" with the reason in a comment. The scan never reopens a closed finding.

## Task type and revenue impact

- Task type: `{f['task_type']}`
- Source: weekly security scan
- Revenue impact: `enabling`
- Expenditure: none

<!-- security-fingerprint: {f['fingerprint']} -->
"""


def load(path):
    if not path:
        return None
    text = Path(path).read_text()
    return json.loads(text) if text.strip() else None


def main(argv=None, gh=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", required=True)
    ap.add_argument("--root", default=".", help="the scanned checkout, to make paths relative")
    ap.add_argument("--gitleaks")
    ap.add_argument("--osv")
    ap.add_argument("--semgrep")
    ap.add_argument("--file", action="store_true", help="open the issues (default: dry run)")
    a = ap.parse_args(argv)
    root = str(Path(a.root).resolve())
    findings, ran = [], []
    try:
        for name, path, parse in (("gitleaks", a.gitleaks, from_gitleaks), ("osv", a.osv, from_osv),
                                  ("semgrep", a.semgrep, from_semgrep)):
            if path:
                findings += parse(load(path), root)
                ran.append(name)
            print(f"{name}: {'ok' if path else 'not run'}")
    except (OSError, ValueError) as e:
        print(f"security_intake: unreadable report: {e}", file=sys.stderr)
        return 2
    filed, skipped = [], []
    seen = set()
    if a.file:
        gh = gh or Gh()
        seen = gh.fingerprints(a.repo)
    for f in findings:
        if f["fingerprint"] in seen:
            skipped.append(f["fingerprint"])
            print(f"dup [{f['tool']}] {f['title']}")
            continue
        print(f"[{f['tool']}] {f['title']}")
        if a.file:
            filed.append(gh.create_issue(a.repo, f["title"], issue_body(f), LABELS))
            seen.add(f["fingerprint"])
    print(f"{len(findings)} findings, {len(filed)} filed, {len(skipped)} already on an issue"
          + ("" if a.file else " (dry run: add --file to open them)"))
    for url in filed:
        print(f"filed {url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
