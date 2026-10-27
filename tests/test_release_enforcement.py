"""Execute release adapters with fake helper outcomes and real git graphs."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPO = "eugnel-ltd/RealTimeTranslation"
GREEN = "Enforcement status: `green since 2026-10-18`\n\n| release | 3 | 0 |\n"
NOT_GREEN = "Enforcement status: `not yet green`\n\n| release | 3 | 0 |\n"
FAKE = r'''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
args=sys.argv[1:]; state=json.loads(pathlib.Path(os.environ['FIXTURE_STATE']).read_text())
with open(os.environ['FIXTURE_LOG'],'a') as f: f.write(json.dumps([pathlib.Path(sys.argv[0]).name,*args])+'\n')
name=pathlib.Path(sys.argv[0]).name
if name=='gh':
 if args[:2]==['pr','merge']: sys.exit(state.get('merge_exit',0))
 if args[:2]==['pr','ready']: sys.exit(0)
 if not args or args[0]!='api': sys.exit(2)
 endpoint=next((a for a in args[1:] if a.startswith('repos/')), '')
 if '--method' in args and args[args.index('--method')+1]!='GET':
  sys.exit(state.get('dispatch_exit',0))
 if endpoint not in state.get('api',{}): print('unsupported fixture endpoint',file=sys.stderr);sys.exit(2)
 data=state['api'][endpoint]
 if isinstance(data,dict) and '__error' in data: sys.exit(2)
 if '--slurp' in args: data=[data]
 raw=json.dumps(data)
 if '--jq' in args:
  p=subprocess.run(['jq','-r',args[args.index('--jq')+1]],input=raw,text=True,capture_output=True)
  sys.stdout.write(p.stdout);sys.exit(p.returncode)
 print(raw);sys.exit(0)
if name=='npm': sys.exit(state.get('build_exit',0))
if name=='npx':
 if 'versions' in args and 'view' in args:
  version=args[args.index('view')+1]
  attempt=json.loads(pathlib.Path(os.environ['FIXTURE_LOG']+'.attempt').read_text())
  print(json.dumps({'id':version,'annotations':{'workers/tag':attempt['tag'],'workers/message':attempt['message']}}));sys.exit(0)
 if 'deployments' in args:
  nfile=pathlib.Path(os.environ['FIXTURE_LOG']+'.list')
  n=int(nfile.read_text()) if nfile.exists() else 0;nfile.write_text(str(n+1))
  if n==0 or state.get('same_deployment') or pathlib.Path(os.environ['FIXTURE_LOG']+'.rolledback').exists(): version='11111111-1111-1111-1111-111111111111';dep='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  else: version='22222222-2222-2222-2222-222222222222';dep='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  if state.get('ambiguous_deployment'): print('[]');sys.exit(0)
  print(json.dumps([{'id':dep,'created_on':'2026-10-18T10:00:00Z','versions':[{'version_id':version,'percentage':100}]}]));sys.exit(0)
 if 'rollback' in args:
  rc=state.get('rollback_exit',0)
  if rc==0: pathlib.Path(os.environ['FIXTURE_LOG']+'.rolledback').write_text('confirmed')
  sys.exit(rc)
 if '--dry-run' in args: sys.exit(state.get('dry_exit',0))
 if 'deploy' in args and '--tag' in args:
  pathlib.Path(os.environ['FIXTURE_LOG']+'.attempt').write_text(json.dumps({'tag':args[args.index('--tag')+1],'message':args[args.index('--message')+1]}))
 sys.exit(state.get('deploy_exit',0))
if name=='node':
 print(json.dumps({'configured':True,'healthy':not state.get('health_failure'),'exitCode':1 if state.get('health_failure') else 0}))
 sys.exit(1 if state.get('health_failure') else 0)
sys.exit(2)
'''


HELPER = r'''#!/bin/sh
exec python3 - "$@" <<'PYTHON'
import json, os, pathlib, sys
name = "HELPER_NAME"
args = sys.argv[1:]
state = json.loads(pathlib.Path(os.environ["FIXTURE_STATE"]).read_text())
with open(os.environ["FIXTURE_HELPER_LOG"], "a") as handle:
    handle.write(json.dumps({"name": name, "args": args, "env": {
        key: os.environ.get(key) for key in (
            "REQUIRED_CHECKS", "RELEASE_REQUIRED_CHECKS", "REVIEW_JOB",
            "EXPECT_EXPENDITURE", "REVIEW_ON_HEAD_COMMENTS")}}) + "\n")
key = args[0] if name == "review_on_head.sh" else args[1]
default_exit = 1 if name == "release_remediation.sh" else 0
outcome = state.get("helpers", {}).get(name, {}).get(key, {})
status = outcome.get("exit", default_exit)
line = outcome.get("stdout", ("HOLD " if status else "EVIDENCE OK ") + key)
print(line)
sys.exit(status)
PYTHON
'''


class ReleaseEnforcement(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.outer = Path(self.tmp.name)
        self.repo = self.outer / "repo"
        self.repo.mkdir()
        self.state_path = self.outer / "state.json"
        self.log = self.outer / "calls.jsonl"
        self.helper_log = self.outer / "helpers.jsonl"
        self.bin = self.outer / "bin"
        self.bin.mkdir()
        for name in ("gh", "npm", "npx", "node"):
            path = self.bin / name
            path.write_text(FAKE)
            path.chmod(0o755)
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", FIXTURE_STATE=str(self.state_path), FIXTURE_LOG=str(self.log), FIXTURE_HELPER_LOG=str(self.helper_log))
        for name in ("REQUIRED_CHECKS", "RELEASE_REQUIRED_CHECKS", "REVIEW_ON_HEAD_COMMENTS", "REVIEW_JOB", "EXPECT_EXPENDITURE"):
            self.env.pop(name, None)
        self.env.update(CLOUDFLARE_API_TOKEN="fixture-token", CLOUDFLARE_ACCOUNT_ID="fixture-account", RTT_UPTIME_ACCESS_CLIENT_ID="fixture-id", RTT_UPTIME_ACCESS_CLIENT_SECRET="fixture-secret")
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        (self.repo / ".ai-sdlc").mkdir()
        shutil.copyfile(ROOT / ".ai-sdlc/manifest_check.py", self.repo / ".ai-sdlc/manifest_check.py")
        for name in ("review_on_head.sh", "head_checks.sh", "release_evidence.sh", "release_remediation.sh"):
            (self.repo / ".ai-sdlc" / name).write_text(HELPER.replace("HELPER_NAME", name))
        (self.repo / "scripts").mkdir()
        for name in ("pr_evidence.py", "auto-merge.py", "web-release.py", "uptime.mjs"):
            source = ROOT / "scripts" / name
            if source.exists():
                shutil.copyfile(source, self.repo / "scripts" / name)
        (self.repo / "docs").mkdir()
        (self.repo / "docs/autonomy-ledger.md").write_text(NOT_GREEN)
        (self.repo / "package.json").write_text('{"version":"1.0.0"}')
        (self.repo / "product.yaml").write_text("id: rtt\nname: RTT\nstatus: building\nrepo: " + REPO + "\nchannels:\n  web:\n    domain: rtt.eugnel.com\n    live_version: null\n    live_since: null\npricing:\n  model: free\n  products: []\nbaseline:\n" + "".join(f"  {name}: done\n" for name in ("accounts", "durable_data", "payments", "legal", "observability", "support", "listing")))
        self.commit("before green")
        self.before = self.git("rev-parse", "HEAD").strip()
        (self.repo / "docs/autonomy-ledger.md").write_text(GREEN)
        self.commit("green transition")
        self.transition = self.git("rev-parse", "HEAD").strip()
        (self.repo / "note.txt").write_text("reviewed source\n")
        self.commit("reviewed release")
        self.sha = self.git("rev-parse", "HEAD").strip()
        self.remote = self.outer / "origin.git"
        subprocess.run(["git", "clone", "--bare", "-q", str(self.repo), str(self.remote)], check=True)
        self.git("remote", "add", "origin", str(self.remote))
        self.git("fetch", "-q", "origin", "main")
        self.state = {"api": {}}
        self.pr(41, "a" * 40, self.transition)
        self.pr(42, "b" * 40, self.sha)
        self.state["api"][f"repos/{REPO}/pulls?state=open&per_page=100"] = [self.info(42)]
        self.save()

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, text=True, capture_output=True, check=True).stdout

    def commit(self, message):
        self.git("add", ".")
        self.git("commit", "-qm", message)

    def info(self, number):
        return self.state["api"][f"repos/{REPO}/pulls/{number}"]

    def pr(self, number, head, merge):
        info = {"number": number, "head": {"sha": head, "repo": {"full_name": REPO}}, "base": {"ref": "main"}, "state": "open", "draft": False, "body": "- Expenditure: none", "merged_at": "2026-10-18T09:00:00Z", "merge_commit_sha": merge}
        self.state["api"][f"repos/{REPO}/pulls/{number}"] = info
        self.state["api"][f"repos/{REPO}/commits/{merge}/pulls"] = [dict(info, state="closed")]
        self.state["api"][f"repos/{REPO}/issues/{number}/comments?per_page=100"] = []

    def save(self):
        self.state_path.write_text(json.dumps(self.state))

    def run_script(self, name, *args):
        self.save()
        return subprocess.run([sys.executable, str(self.repo / "scripts" / name), *args], cwd=self.repo, env=self.env, text=True, capture_output=True)

    def release(self, *args):
        return self.run_script("web-release.py", self.sha, *args)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def helper_calls(self, name=None):
        calls = [json.loads(line) for line in self.helper_log.read_text().splitlines()] if self.helper_log.exists() else []
        return [call for call in calls if name is None or call["name"] == name]

    def outcome(self, name, key, status, line):
        self.state.setdefault("helpers", {}).setdefault(name, {})[key] = {"exit": status, "stdout": line}

    def new_commit(self, number):
        (self.repo / "note.txt").write_text(f"reviewed source {number}\n")
        self.commit(f"reviewed release {number}")
        self.sha = self.git("rev-parse", "HEAD").strip()
        self.git("push", "-q", "origin", "main")
        self.pr(number, f"{number:040x}", self.sha)
        return self.sha

    def merged(self):
        return any(call[:3] == ["gh", "pr", "merge"] for call in self.calls())

    def applied(self):
        return any(call[0] == "npx" and "deploy" in call and "--dry-run" not in call for call in self.calls())

    def test_release_helpers_get_default_checks_and_no_comment_override(self):
        self.env.update(REQUIRED_CHECKS="inherited-required", RELEASE_REQUIRED_CHECKS="inherited-release")
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        calls = self.helper_calls("release_evidence.sh")
        self.assertEqual([call["args"] for call in calls], [
            [REPO, commit, "--base", "main"] for commit in (self.sha, self.transition)])
        for call in calls:
            self.assertIsNone(call["env"]["REQUIRED_CHECKS"])
            self.assertIsNone(call["env"]["RELEASE_REQUIRED_CHECKS"])
            self.assertIsNone(call["env"]["REVIEW_ON_HEAD_COMMENTS"])
        self.assertFalse(any("/comments?" in " ".join(call) for call in self.calls()))

    def test_successful_evidence_prints_only_the_helper_last_line(self):
        line = f"EVIDENCE OK {self.sha}: fixture proof"
        self.outcome("release_evidence.sh", self.sha, 0, "diagnostic\n" + line)
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn(line, result.stdout)
        self.assertNotIn("diagnostic", result.stdout)

    def test_held_commit_uses_later_proved_commits_newest_first(self):
        older = self.sha
        middle = self.new_commit(43)
        newest = self.new_commit(44)
        held = f"HOLD {older}: missing head evidence"
        remediated = f"REMEDIATED {older} by {newest}"
        self.env.update(REQUIRED_CHECKS="inherited-required", RELEASE_REQUIRED_CHECKS="inherited-release")
        self.outcome("release_evidence.sh", older, 1, held)
        self.outcome("release_remediation.sh", older, 0, "diagnostic\n" + remediated)
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn(remediated, result.stdout)
        self.assertNotIn("diagnostic", result.stdout)
        calls = self.helper_calls("release_remediation.sh")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["args"], [REPO, older, newest, middle, "--base", "main"])
        self.assertIsNone(calls[0]["env"]["REQUIRED_CHECKS"])
        self.assertIsNone(calls[0]["env"]["RELEASE_REQUIRED_CHECKS"])
        release_calls = self.helper_calls("release_evidence.sh")
        self.assertEqual([call["args"][1] for call in release_calls], [newest, middle, older, self.transition])
        self.assertIn("4 green-chain commits", result.stdout)

    def test_newest_held_commit_cannot_remediate_without_proved_commit(self):
        held = f"HOLD {self.sha}: no proved successor"
        self.outcome("release_evidence.sh", self.sha, 1, held)
        result = self.release("--apply")
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertIn(held, result.stderr + result.stdout)
        self.assertEqual(self.helper_calls("release_remediation.sh"), [])
        self.assertFalse(self.applied())

    def test_failed_remediation_preserves_original_evidence_hold_line(self):
        held = f"HOLD {self.transition}: no accepted remediation"
        self.outcome("release_evidence.sh", self.transition, 1, "diagnostic\n" + held)
        self.outcome("release_remediation.sh", self.transition, 1, "HOLD no remediation claim")
        result = self.release("--apply")
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertIn(held, result.stderr + result.stdout)
        self.assertEqual(self.helper_calls("release_remediation.sh")[0]["args"],
                         [REPO, self.transition, self.sha, "--base", "main"])
        self.assertFalse(self.applied())

    def test_release_helper_error_never_attempts_remediation(self):
        self.outcome("release_evidence.sh", self.transition, 2, "internal fixture error")
        result = self.release("--apply")
        self.assertEqual(result.returncode, 2, result.stderr + result.stdout)
        self.assertEqual(self.helper_calls("release_remediation.sh"), [])
        self.assertFalse(self.applied())

    def test_remediation_error_fails_closed(self):
        self.outcome("release_evidence.sh", self.transition, 1, "HOLD initial evidence")
        self.outcome("release_remediation.sh", self.transition, 2, "internal fixture error")
        result = self.release("--apply")
        self.assertEqual(result.returncode, 2, result.stderr + result.stdout)
        self.assertEqual(len(self.helper_calls("release_remediation.sh")), 1)
        self.assertFalse(self.applied())

    def test_auto_merge_passes_required_checks_and_review_contract(self):
        result = self.run_script("auto-merge.py", "--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        calls = self.helper_calls()
        self.assertEqual([call["name"] for call in calls], ["review_on_head.sh", "head_checks.sh"])
        self.assertEqual(calls[0]["args"], ["42", "b" * 40, "--repo", REPO, "--auto-merge"])
        self.assertEqual(calls[1]["args"], [REPO, "42", "b" * 40])
        for call in calls:
            self.assertIn("test", call["env"]["REQUIRED_CHECKS"].split(","))
            self.assertEqual(call["env"]["REVIEW_JOB"], "checks / Independent APPROVE names the head")
            self.assertEqual(call["env"]["EXPECT_EXPENDITURE"], "none")
            self.assertIsNone(call["env"]["REVIEW_ON_HEAD_COMMENTS"])
        self.assertFalse(any("/comments?" in " ".join(call) for call in self.calls()))

    def test_preflight_checks_every_green_merge_including_transition_without_deploying(self):
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        endpoints = [call[2] for call in self.calls() if call[:2] == ["gh", "api"]]
        for sha in (self.transition, self.sha):
            self.assertIn(f"repos/{REPO}/commits/{sha}/pulls", endpoints)
        self.assertFalse(self.applied())

    def test_missing_or_ambiguous_or_unmerged_mapping_holds(self):
        key = f"repos/{REPO}/commits/{self.transition}/pulls"
        original = self.state["api"][key]
        for data in ([], original + original, [dict(original[0], merged_at=None)], [dict(original[0], state="open")]):
            with self.subTest(data=data):
                self.state["api"][key] = data
                result = self.release("--apply")
                self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
                self.assertFalse(self.applied())

    def test_baseline_missing_holds_before_apply(self):
        path = self.repo / "product.yaml"
        path.write_text(path.read_text().replace("support: done", "support: missing"))
        self.commit("missing baseline")
        self.sha = self.git("rev-parse", "HEAD").strip()
        self.git("push", "-q", "origin", "main")
        self.pr(43, "c" * 40, self.sha)
        result = self.release("--apply")
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertIn("baseline.support", result.stderr + result.stdout)
        self.assertFalse(self.applied())

    def test_dirty_or_wrong_main_holds(self):
        (self.repo / "untracked.txt").write_text("dirty")
        result = self.release("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("clean", result.stderr + result.stdout)
        (self.repo / "untracked.txt").unlink()
        result = self.run_script("web-release.py", self.transition, "--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("main", result.stderr + result.stdout)
        self.assertFalse(self.applied())

    def test_not_green_and_low_level_hold(self):
        for ledger in (NOT_GREEN, GREEN.replace("release | 3", "release | 2")):
            (self.repo / "docs/autonomy-ledger.md").write_text(ledger)
            self.commit("held ledger")
            self.sha = self.git("rev-parse", "HEAD").strip()
            self.git("push", "-q", "origin", "main")
            result = self.release("--apply")
            self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
            self.assertFalse(self.applied())

    def test_apply_requires_capabilities_before_build_or_provider_mutation(self):
        self.env.pop("CLOUDFLARE_API_TOKEN")
        result = self.release("--apply")
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertFalse(any(call[0] in ("npm", "npx") for call in self.calls()))

    def test_apply_builds_dry_runs_deploys_exact_sha_and_checks_health(self):
        result = self.release("--apply")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        deploy = [call for call in self.calls() if call[0] == "npx" and "deploy" in call and "--dry-run" not in call]
        self.assertEqual(len(deploy), 1)
        self.assertIn(f"DEPLOYMENT_SHA:{self.sha}", deploy[0])
        health = [call for call in self.calls() if call[0] == "node"]
        self.assertTrue(any(self.sha in " ".join(call) for call in health))
        self.assertIn("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", result.stdout)

    def test_health_failure_rolls_back_explicit_previous_version(self):
        self.state["health_failure"] = True
        result = self.release("--apply")
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        rollbacks = [call for call in self.calls() if call[0] == "npx" and "rollback" in call]
        self.assertEqual(len(rollbacks), 1)
        self.assertIn("11111111-1111-1111-1111-111111111111", rollbacks[0])

    def test_dry_run_failure_never_applies_or_rolls_back(self):
        self.state["dry_exit"] = 1
        result = self.release("--apply")
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertFalse(self.applied())
        self.assertFalse(any("rollback" in call for call in self.calls()))

    def test_auto_merge_pins_reviewed_head_and_dispatches_real_workflow(self):
        result = self.run_script("auto-merge.py")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        merges = [call for call in self.calls() if call[:3] == ["gh", "pr", "merge"]]
        self.assertEqual(len(merges), 1)
        self.assertIn("--match-head-commit", merges[0])
        self.assertIn("b" * 40, merges[0])
        self.assertTrue(any("web-release-check.yml/dispatches" in " ".join(call) for call in self.calls()))

    def test_auto_merge_dry_run_writes_nothing(self):
        result = self.run_script("auto-merge.py", "--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("AUTO-MERGE READY", result.stdout)
        self.assertFalse(self.merged())
        self.assertFalse(any("--method" in call for call in self.calls()))

    def test_auto_merge_holds_fork_wrong_base_spend_or_closed(self):
        info = self.info(42)
        original = json.loads(json.dumps(info))
        for mutation in ("fork", "base", "spend", "closed"):
            with self.subTest(mutation=mutation):
                info.clear()
                info.update(json.loads(json.dumps(original)))
                if mutation == "fork": info["head"]["repo"]["full_name"] = "outsider/repo"
                if mutation == "base": info["base"]["ref"] = "other"
                if mutation == "spend": info["body"] = "- Expenditure: proposed"
                if mutation == "closed": info["state"] = "closed"
                result = self.run_script("auto-merge.py")
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertFalse(self.merged())

    def test_auto_merge_review_or_check_hold_never_merges(self):
        for name, key in (("review_on_head.sh", "42"), ("head_checks.sh", "42")):
            with self.subTest(helper=name):
                self.state["helpers"] = {name: {key: {"exit": 1}}}
                result = self.run_script("auto-merge.py")
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertFalse(self.merged())

    def test_auto_merge_error_still_dispatches_after_prior_success(self):
        self.state["api"][f"repos/{REPO}/pulls?state=open&per_page=100"].append({"number": 43})
        self.state["api"][f"repos/{REPO}/pulls/43"] = {"__error": True}
        result = self.run_script("auto-merge.py")
        self.assertEqual(result.returncode, 2, result.stderr + result.stdout)
        self.assertTrue(self.merged())
        self.assertTrue(any("web-release-check.yml/dispatches" in " ".join(call) for call in self.calls()))


if __name__ == "__main__":
    unittest.main()
