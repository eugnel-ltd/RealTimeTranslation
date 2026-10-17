#!/usr/bin/env python3
"""Check wrangler configs against modules/autonomy.md's Cloudflare cost guard.

    cf_cost_check.py --tree DIR [--base REF] [--decisions FILE]
    cf_cost_check.py --head REF [--base REF] [--decisions FILE]

Exit 0 pass, 1 rule failure, 2 unreadable or unparseable input (including no TOML parser).
Git mode reads trees and blobs only; it never checks out or executes PR code.
Each cron entry is checked alone over a day, including its own midnight wrap.
Named envs inherit main and HTTP settings for this check. Unlike Wrangler's binding
inheritance, this guard accepts top-level limits/ratelimits when absent in an env.
Source-name presence is a lexical check; the reviewer checks actual rate-limit use.
"""
import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib
    except ImportError:
        tomllib = None

CRON_FLOOR_MINUTES = 15
CPU_MS_MAX = 5000
SUBREQUESTS_MAX = 1000
PAID_KEYS = [
    "durable_objects", "queues", "images", "logpush", "analytics_engine_datasets",
    "browser", "vectorize", "ai", "hyperdrive", "workflows", "dispatch_namespaces",
    "containers", "pipelines", "tail_consumers", "mtls_certificates",
    "secrets_store_secrets", "unsafe", "worker_loaders", "ai_search",
    "ai_search_namespaces", "agent_memory", "media", "vpc_services", "vpc_networks",
    "flagship", "analytics", "site",
]
CONFIG_NAMES = {"wrangler.toml", "wrangler.json", "wrangler.jsonc"}
SOURCE_SKIP = {"node_modules", "dist", ".open-next", ".wrangler"}
SOURCE_SUFFIXES = {".js", ".mjs", ".ts", ".tsx"}
# "Expenditure:" at the start of a line, after an optional list marker or "- Decision:".
EXPENDITURE = re.compile(r"^\s*(?:[-*]\s*)?(?:Decision:\s*)?Expenditure:", re.I)


def git(*args):
    result = subprocess.run(["git", *args], capture_output=True)
    if result.returncode != 0:
        raise ValueError("git " + args[0] + ": " + result.stderr.decode("utf-8", "replace").strip())
    return result.stdout


class Tree:
    def __init__(self, directory=None, ref=None):
        self.directory = Path(directory) if directory is not None else None
        self.ref = ref
        if ref is not None:
            # -z preserves spaces, tabs and non-ASCII paths without git's quoting.
            self.files = sorted(os.fsdecode(p) for p in
                                git("ls-tree", "-r", "--name-only", "-z", ref).split(b"\0") if p)
        else:
            if not self.directory.is_dir():
                raise ValueError(f"not a directory: {directory}")
            self.files = []
            def walk_error(error):
                raise error
            for root, dirs, files in os.walk(self.directory, onerror=walk_error):
                dirs[:] = sorted(d for d in dirs if d not in {"node_modules", ".git"})
                self.files.extend((Path(root) / f).relative_to(self.directory).as_posix()
                                  for f in files)
            self.files.sort()

    def read(self, path):
        if self.ref is not None:
            return git("show", f"{self.ref}:{path}").decode("utf-8")
        return (self.directory / path).read_text(encoding="utf-8")

    def has_dir(self, path):
        if self.ref is not None:
            return any(p.startswith(path.rstrip("/") + "/") for p in self.files)
        return (self.directory / path).is_dir()

    def configs(self):
        return [p for p in self.files if PurePosixPath(p).name in CONFIG_NAMES
                and "node_modules" not in PurePosixPath(p).parts]

    def sources(self, config):
        parent = PurePosixPath(config).parent
        for path in self.files:
            p = PurePosixPath(path)
            try:
                relative = p.relative_to(parent)
            except ValueError:
                continue
            if p.suffix in SOURCE_SUFFIXES and not SOURCE_SKIP.intersection(relative.parts):
                yield self.read(path)


def strip_jsonc(text):
    # Tokenise strings first so URLs, escaped quotes and comment markers stay intact.
    token = re.compile(r'"(?:\\.|[^"\\])*"|//[^\r\n]*|/\*[\s\S]*?\*/')
    text = token.sub(lambda m: m[0] if m[0].startswith('"') else
                    re.sub(r'[^\r\n]', ' ', m[0]), text)
    # Match strings here too: a comma and brace inside a string are ordinary data.
    return re.sub(r'"(?:\\.|[^"\\])*"|,(\s*[}\]])',
                  lambda m: m[1] if m[1] is not None else m[0], text)


def parse(tree, path):
    try:
        raw = tree.read(path)
        data = tomllib.loads(raw) if path.endswith(".toml") else json.loads(
            strip_jsonc(raw) if path.endswith(".jsonc") else raw)
        if not isinstance(data, dict):
            raise ValueError("config must be an object")
        return data
    except (ValueError, OSError) as error:
        raise ValueError(f"{path}: {error}") from error


def blocks(data):
    yield None, data
    envs = data.get("env", {})
    if not isinstance(envs, dict):
        raise ValueError("env must be an object")
    for name, block in envs.items():
        if not isinstance(block, dict):
            raise ValueError(f"env.{name} must be an object")
        yield name, block


def paid_keys(block):
    keys = {k for k in PAID_KEYS if k in block and
            (k != "logpush" or block[k] is True)}
    for migration in block.get("migrations", []):
        for key in ("new_classes", "new_sqlite_classes"):
            if key in migration:
                keys.add("migrations." + key)
    def observability(value, prefix):
        if isinstance(value, dict):
            for key, child in value.items():
                full = prefix + "." + key
                if key == "destinations" or full in {"observability.traces", "observability.issues"}:
                    keys.add(full)
                observability(child, full)
        elif isinstance(value, list):
            for child in value:
                observability(child, prefix)
    observability(block.get("observability", {}), "observability")
    return keys


def expand(field, maximum):
    values = set()
    for part in field.split(","):
        match = re.fullmatch(r'(\*|[0-9]+(?:-[0-9]+)?)(?:/([0-9]+))?', part)
        if not match:
            raise ValueError(f"cannot expand field {field!r}")
        span, step = match.groups()
        step = int(step) if step else 1
        if step < 1:
            raise ValueError(f"invalid step in {field!r}")
        if span == "*":
            start, end = 0, maximum
        elif "-" in span:
            start, end = map(int, span.split("-"))
        else:
            if match[2] is not None:
                raise ValueError(f"cannot expand field {field!r}")
            start = end = int(span)
        if not 0 <= start <= end <= maximum:
            raise ValueError(f"field out of range: {field!r}")
        values.update(range(start, end + 1, step))
    return sorted(values)


def cron_gap(cron):
    if not isinstance(cron, str) or len(cron.split()) != 5:
        raise ValueError("expected five cron fields")
    minute, hour, *_ = cron.split()
    times = sorted(h * 60 + m for h in expand(hour, 23) for m in expand(minute, 59))
    return min(b - a for a, b in zip(times, times[1:] + [times[0] + 1440]))


def approves(line, key):
    # An owner decision approves a paid key when its Expenditure line names Cloudflare and the key
    # as a whole word, so "ai" does not match "maintain".
    return (re.search(r"\bcloudflare\b", line, re.I) is not None and
            re.search(r"(?<![\w.])" + re.escape(key) + r"(?![\w])", line, re.I) is not None)


def bounded(value, maximum):
    return type(value) is int and 1 <= value <= maximum


def check(tree, path, data, existing, decisions):
    findings = []
    def finding(env, rule, detail, level="FAIL"):
        findings.append(f"{level} {path}[{env if env is not None else 'top'}]: {rule}: {detail}")
    for env, block in blocks(data):
        crons = block.get("triggers", {}).get("crons", [])
        if not isinstance(crons, list):
            raise ValueError(f"{path}[{env}]: triggers.crons must be an array")
        for cron in crons:
            try:
                gap = cron_gap(cron)
                if gap < CRON_FLOOR_MINUTES:
                    finding(env, "cron floor", f"{cron!r}: minimum gap {gap} minutes; need {CRON_FLOOR_MINUTES}")
            except ValueError as error:
                finding(env, "cron floor", f"{cron!r}: {error}")
        for key in sorted(paid_keys(block)):
            if (path, env, key) in existing:
                finding(env, "paid feature", f"{key}: existing on base", "WARN")
            elif not any(approves(line, key) for line in decisions):
                finding(env, "paid feature", f"{key}: no Expenditure: decision; remove it or obtain approval")
        effective = {**data, **block}
        main = effective.get("main")
        pages = effective.get("pages_build_output_dir") and tree.has_dir(
            str(PurePosixPath(path).parent / "functions"))
        if main or pages:
            limits = effective.get("limits", {})
            for key, maximum in [("cpu_ms", CPU_MS_MAX)] + ([("subrequests", SUBREQUESTS_MAX)] if main else []):
                if not isinstance(limits, dict) or not bounded(limits.get(key), maximum):
                    finding(env, "invocation limit", f"limits.{key} must be an integer between 1 and {maximum}")
        if main and (effective.get("routes") or effective.get("route") or effective.get("workers_dev") is not False):
            bindings = effective.get("ratelimits", [])
            names = [b.get("name") for b in bindings if isinstance(b, dict)] if isinstance(bindings, list) else []
            names = [n for n in names if isinstance(n, str) and n]
            if not names:
                finding(env, "rate limit", "HTTP Worker needs a named ratelimits binding")
            else:
                sources = list(tree.sources(path))
                if not any(name in source for name in names for source in sources):
                    finding(env, "rate limit", "ratelimits binding name is unused in source files")
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--tree")
    mode.add_argument("--head")
    parser.add_argument("--base")
    parser.add_argument("--decisions")
    args = parser.parse_args()
    if tomllib is None:
        print("CF-COST: Python 3.11+ (tomllib) or an importable tomli is required", file=sys.stderr)
        return 2
    try:
        tree = Tree(directory=args.tree, ref=args.head)
        existing = set()
        if args.base:
            base = Tree(ref=args.base)
            for path in base.configs():
                for env, block in blocks(parse(base, path)):
                    existing.update((path, env, key) for key in paid_keys(block))
        decisions = []
        if args.decisions:
            try:
                decisions = [line.strip() for line in Path(args.decisions).read_text(encoding="utf-8").splitlines()
                             if EXPENDITURE.match(line)]
            except FileNotFoundError:
                pass
        configs = tree.configs()
        findings = []
        for path in configs:
            findings.extend(check(tree, path, parse(tree, path), existing, decisions))
        for line in findings:
            print(line)
        problems = sum(line.startswith("FAIL ") for line in findings)
        print(f"CF-COST: FAIL ({problems} problems)" if problems else
              "CF-COST: PASS" if configs else "CF-COST: PASS (no wrangler config)")
        return 1 if problems else 0
    except (OSError, ValueError, TypeError, AttributeError) as error:
        print(f"CF-COST: input error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
