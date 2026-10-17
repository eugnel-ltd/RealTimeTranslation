#!/usr/bin/env python3
"""Check a product.yaml manifest against the rules in modules/baseline.md.

    manifest_check.py <product.yaml> [--publishing <channel>]

Exit 0 when the manifest is valid. Exit 1 with one line per problem otherwise. Exit 2 when the
file cannot be read or parsed, or when PyYAML is missing (the check holds when unsure).

Rules, beyond the shape (schemas/product.schema.json):
- `status: published`, or `--publishing <channel>`, needs every required baseline item `done`,
  `waived` or `excluded`. Required always: accounts, legal, observability, support, listing. Required when
  `pricing.model` is not `free`: durable_data, payments.
- A `waived` item needs a non-empty entry under `waivers` naming the owner decision.
- `excluded` (accounts and durable_data only) means the item is not part of the product by design:
  it needs an entry under `exclusions` that quotes the north star's non-goal; it counts as met
  for publishing. The reviewer checks the quote against the north star.
- `--publishing <channel>` needs that channel under `channels`.
- A channel with `live_version` set needs `live_since`, and the reverse. `live_version` is a
  string; `live_since` is a real calendar date, YYYY-MM-DD.
- Every identifier is a string: `north_star`, `support`, `channels.<name>.domain`, `bundle_id`,
  `package`, `asin` (or null), and each `store_ids` value (or null).
- A product with `pricing.model` other than `free` and `status: published` needs at least one
  entry under `pricing.products`.
- The optional `legal` block (read by eugnel-platform's legal package): `audience` is children or
  general; `effective` is a real date; each `data` entry has string category, purpose, basis,
  retention and linked; each `processors` entry has string name, purpose and location.
- The optional `sentry` block (read by the support intake, modules/support.md): `org` and
  `project` are Sentry slugs; `scope` is server, client or all.

The script reads the file as data and executes nothing from it.
"""
import datetime
import re
import sys

STATUSES = ("idea", "building", "published", "sunset")
MODELS = ("free", "one-off", "subscription")
CHANNELS = ("web", "ios", "play", "fire", "steam", "msstore")
BASELINE_ITEMS = ("accounts", "durable_data", "payments", "legal", "observability", "support", "listing")
BASELINE_VALUES = ("done", "missing", "waived", "excluded")
EXCLUDABLE = ("accounts", "durable_data")
REQUIRED_ALWAYS = ("accounts", "legal", "observability", "support", "listing")
REQUIRED_WHEN_PAID = ("durable_data", "payments")
TOP_REQUIRED = ("id", "name", "status", "repo", "channels", "pricing", "baseline")
TOP_ALLOWED = TOP_REQUIRED + ("north_star", "support", "waivers", "exclusions", "legal", "assets", "sentry")
LEGAL_AUDIENCES = ("children", "general")
LEGAL_LISTS = {
    "data": ("category", "purpose", "basis", "retention", "linked"),
    "processors": ("name", "purpose", "location"),
}
CHANNEL_IDS = {"web": "domain", "ios": "bundle_id", "play": "package", "fire": "asin"}
ASSET_TYPES = ("voice", "sfx", "music", "image", "video", "model3d")
ASSET_PLANS = ("owner", "runner")
GENERATOR_KEYS = ("tool", "types", "terms", "plan")
SENTRY_KEYS = ("org", "project", "scope")
SENTRY_SCOPES = ("server", "client", "all")
SLUG = r"[a-z0-9][a-z0-9_-]*"


def is_date(value):
    """True for a real calendar date: a YYYY-MM-DD string, or the date YAML makes of an unquoted one."""
    if isinstance(value, datetime.date) and not isinstance(value, datetime.datetime):
        return True
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        return False
    return True


def load(path):
    try:
        import yaml  # PyYAML
    except ImportError:
        return None, "PyYAML is not installed (pip install pyyaml)"
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except OSError as e:
        return None, f"cannot read {path}: {e}"
    except yaml.YAMLError as e:
        return None, f"cannot parse {path}: {e}"
    if not isinstance(data, dict):
        return None, f"{path}: the top level is not a mapping"
    return data, None


def required_items(model):
    items = list(REQUIRED_ALWAYS)
    if model != "free":
        items += REQUIRED_WHEN_PAID
    return items


def check_legal(legal):
    """Problems in the optional `legal` block (empty when absent or valid)."""
    if legal is None:
        return []
    if not isinstance(legal, dict):
        return ["legal: must be a mapping"]
    problems = []
    for key in legal:
        if key not in ("audience", "effective") + tuple(LEGAL_LISTS):
            problems.append(f"legal.{key}: unknown key (allowed: audience, effective, data, processors)")
    if "audience" in legal and legal["audience"] not in LEGAL_AUDIENCES:
        problems.append(f"legal.audience: must be one of {', '.join(LEGAL_AUDIENCES)}")
    if "effective" in legal and not is_date(str(legal["effective"])):
        problems.append("legal.effective: must be a real date, YYYY-MM-DD")
    for name, fields in LEGAL_LISTS.items():
        entries = legal.get(name, [])
        if not isinstance(entries, list):
            problems.append(f"legal.{name}: must be a list")
            continue
        for i, entry in enumerate(entries):
            if not isinstance(entry, dict):
                problems.append(f"legal.{name}[{i}]: must be a mapping")
                continue
            for field in fields:
                if not isinstance(entry.get(field), str) or not entry.get(field).strip():
                    problems.append(f"legal.{name}[{i}].{field}: must be a non-empty string")
    return problems


def check_sentry(sentry):
    """Problems in the optional `sentry` block (empty when absent or valid)."""
    if sentry is None:
        return []
    if not isinstance(sentry, dict):
        return ["sentry: must be a mapping"]
    problems = [f"sentry.{k}: unknown key (allowed: {', '.join(SENTRY_KEYS)})" for k in sentry if k not in SENTRY_KEYS]
    for key in ("org", "project"):
        if not isinstance(sentry.get(key), str) or not re.fullmatch(SLUG, sentry.get(key) or ""):
            problems.append(f"sentry.{key}: must be a Sentry slug (a-z, 0-9, -, _)")
    if "scope" in sentry and sentry["scope"] not in SENTRY_SCOPES:
        problems.append(f"sentry.scope: must be one of {', '.join(SENTRY_SCOPES)}")
    return problems


def check(data, publishing=None):
    """Return the list of problems (empty when valid)."""
    problems = []
    for key in TOP_REQUIRED:
        if key not in data:
            problems.append(f"missing top-level key: {key}")
    for key in data:
        if key not in TOP_ALLOWED:
            problems.append(f"unknown top-level key: {key}")

    pid = data.get("id")
    if not isinstance(pid, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", pid or ""):
        problems.append("id: must be a lower-case slug (a-z, 0-9, -)")
    if not isinstance(data.get("name"), str) or not data.get("name"):
        problems.append("name: must be a non-empty string")
    status = data.get("status")
    if status not in STATUSES:
        problems.append(f"status: must be one of {', '.join(STATUSES)}")
    repo = data.get("repo")
    if not isinstance(repo, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo or ""):
        problems.append("repo: must be owner/name")
    for key in ("north_star", "support"):
        if key in data and (not isinstance(data[key], str) or not data[key]):
            problems.append(f"{key}: must be a non-empty string")

    channels = data.get("channels")
    if not isinstance(channels, dict):
        problems.append("channels: must be a mapping")
        channels = {}
    for name, ch in channels.items():
        if name not in CHANNELS:
            problems.append(f"channels.{name}: unknown channel (allowed: {', '.join(CHANNELS)})")
            continue
        if not isinstance(ch, dict):
            problems.append(f"channels.{name}: must be a mapping")
            continue
        version, since = ch.get("live_version"), ch.get("live_since")
        if (version is None) != (since is None):
            problems.append(f"channels.{name}: live_version and live_since go together")
        if version is not None and (not isinstance(version, str) or not version):
            problems.append(f"channels.{name}.live_version: must be a non-empty string")
        if since is not None and not is_date(since):
            problems.append(f"channels.{name}.live_since: must be a real date, YYYY-MM-DD")
        id_key = CHANNEL_IDS.get(name)
        if id_key and id_key in ch:
            ident = ch[id_key]
            if not isinstance(ident, str) and not (name == "fire" and ident is None):
                problems.append(f"channels.{name}.{id_key}: must be a string")

    pricing = data.get("pricing")
    if not isinstance(pricing, dict):
        problems.append("pricing: must be a mapping")
        pricing = {}
    model = pricing.get("model")
    if model not in MODELS:
        problems.append(f"pricing.model: must be one of {', '.join(MODELS)}")
        model = "free"
    products = pricing.get("products", [])
    if not isinstance(products, list):
        problems.append("pricing.products: must be a list")
        products = []
    for i, p in enumerate(products):
        if not isinstance(p, dict) or not isinstance(p.get("sku"), str) or not p.get("sku"):
            problems.append(f"pricing.products[{i}]: needs a sku")
            continue
        store_ids = p.get("store_ids", {})
        if not isinstance(store_ids, dict):
            problems.append(f"pricing.products[{i}].store_ids: must be a mapping")
        else:
            for ch_name, sid in store_ids.items():
                if sid is not None and not isinstance(sid, str):
                    problems.append(f"pricing.products[{i}].store_ids.{ch_name}: must be a string or null")

    problems += check_legal(data.get("legal"))
    problems += check_sentry(data.get("sentry"))

    baseline = data.get("baseline")
    if not isinstance(baseline, dict):
        problems.append("baseline: must be a mapping")
        baseline = {}
    waivers = data.get("waivers") or {}
    if not isinstance(waivers, dict):
        problems.append("waivers: must be a mapping of item -> decision")
        waivers = {}
    exclusions = data.get("exclusions") or {}
    if not isinstance(exclusions, dict):
        problems.append("exclusions: must be a mapping of item -> the north star's non-goal")
        exclusions = {}
    for item in BASELINE_ITEMS:
        value = baseline.get(item)
        if value not in BASELINE_VALUES:
            problems.append(f"baseline.{item}: must be one of {', '.join(BASELINE_VALUES)}")
        elif value == "waived":
            decision = waivers.get(item)
            if not isinstance(decision, str) or not decision.strip():
                problems.append(f"baseline.{item}: waived without a decision under waivers.{item}")
        elif value == "excluded":
            quote = exclusions.get(item)
            if item not in EXCLUDABLE:
                problems.append(f"baseline.{item}: only {', '.join(EXCLUDABLE)} can be excluded; use waived with an owner decision")
            elif not isinstance(quote, str) or not quote.strip():
                problems.append(f"baseline.{item}: excluded without the north star's non-goal under exclusions.{item}")
            elif not isinstance(data.get("north_star"), str) or not data.get("north_star"):
                problems.append(f"baseline.{item}: excluded, but the manifest names no north_star to quote")
    for item in baseline:
        if item not in BASELINE_ITEMS:
            problems.append(f"baseline.{item}: unknown item (allowed: {', '.join(BASELINE_ITEMS)})")

    # Generated assets (modules/assets.md): every generator names its tool, types and terms.
    if "assets" in data:
        assets = data["assets"]
        if not isinstance(assets, dict):
            problems.append("assets: must be a mapping")
            assets = {}
        for key in assets:
            if key not in ("provenance", "generators"):
                problems.append(f"assets.{key}: unknown key (allowed: provenance, generators)")
        prov = assets.get("provenance")
        if not isinstance(prov, str) or not prov:
            problems.append("assets.provenance: must be a non-empty path")
        gens = assets.get("generators", [])
        if not isinstance(gens, list):
            problems.append("assets.generators: must be a list")
            gens = []
        for i, g in enumerate(gens):
            if not isinstance(g, dict):
                problems.append(f"assets.generators[{i}]: must be a mapping")
                continue
            for key in g:
                if key not in GENERATOR_KEYS:
                    problems.append(f"assets.generators[{i}].{key}: unknown key (allowed: {', '.join(GENERATOR_KEYS)})")
            tool = g.get("tool")
            if not isinstance(tool, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", tool or ""):
                problems.append(f"assets.generators[{i}].tool: must be a lower-case slug")
            types = g.get("types")
            if not isinstance(types, list) or not types:
                problems.append(f"assets.generators[{i}].types: must be a non-empty list")
            else:
                for t in types:
                    if t not in ASSET_TYPES:
                        problems.append(f"assets.generators[{i}].types: unknown type {t!r} (allowed: {', '.join(ASSET_TYPES)})")
            terms = g.get("terms")
            if not isinstance(terms, str) or not terms.strip():
                problems.append(f"assets.generators[{i}].terms: must name the terms that allow commercial use")
            if "plan" in g and g["plan"] not in ASSET_PLANS:
                problems.append(f"assets.generators[{i}].plan: must be one of {', '.join(ASSET_PLANS)}")

    # The publish gate.
    gate = status == "published" or publishing is not None
    if publishing is not None and publishing not in channels:
        problems.append(f"--publishing {publishing}: channel is not in the manifest")
    if gate:
        for item in required_items(model):
            if baseline.get(item) not in ("done", "waived", "excluded"):
                problems.append(f"PUBLISH BLOCKED: baseline.{item} is not done, waived or excluded")
        if model != "free" and not products:
            problems.append("PUBLISH BLOCKED: pricing.model is paid but pricing.products is empty")
    return problems


def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(__doc__.strip())
        return 2
    path, publishing = argv[1], None
    rest = argv[2:]
    while rest:
        if rest[0] == "--publishing" and len(rest) > 1:
            publishing = rest[1]
            rest = rest[2:]
        else:
            print(f"manifest_check: unknown argument {rest[0]}", file=sys.stderr)
            return 2
    data, err = load(path)
    if err:
        print(f"MANIFEST ERROR: {err}")
        return 2
    problems = check(data, publishing)
    if problems:
        print(f"MANIFEST FAIL: {path}: {len(problems)} problem(s)")
        for p in problems:
            print(f"  {p}")
        return 1
    print(f"MANIFEST OK: {path} ({data.get('id')}, {data.get('status')})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
