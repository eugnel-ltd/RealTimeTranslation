#!/usr/bin/env python3
"""Warn when a PR names no vendor or reason for keeping code in Claude."""
from __future__ import annotations

import argparse
from pathlib import Path
import re

WARNING = ('::warning title=Written by::This PR\'s code was written by Claude without a vendor '
           'hand-off reason. Hand code to codex first (modules/vendors.md), or write '
           '"Claude: design work" or "Claude: vendor lane exited 1".')


def classify(body):
    match = re.search(r"^(?:- )?Written by:(.*)$", body or "", re.I | re.M)
    line = match.group(1).lower() if match else ""
    if re.search(r"<.*>", line):
        return "unknown"
    if re.search(r"\b(codex|grokbot|grok|antigravity|claude-team|vendor_run)\b", line):
        return "vendor"
    if "design work" in line:
        return "design"
    if "exited 1" in line:
        return "lane-failed"
    return "claude" if "claude" in line else "unknown"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--body-file", required=True)
    ap.add_argument("--files")
    a = ap.parse_args(argv)
    try:
        paths = Path(a.files).read_text(encoding="utf-8").splitlines() if a.files else []
        if paths and all(p.lower().endswith(".md") for p in paths):
            print("written-by: docs only")
            return 0
        kind = classify(Path(a.body_file).read_text(encoding="utf-8"))
    except (OSError, UnicodeError) as e:
        print(f"::warning title=Written by::Not checked: {str(e).replace(chr(10), ' ')}")
        print("written-by: not checked (unreadable input)")
        return 0
    if kind in ("claude", "unknown"):
        print(WARNING)
    print(f"written-by: {kind}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
