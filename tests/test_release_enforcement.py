"""Execute the release adapters, unchanged upstream helpers and real git graphs."""
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
CONTEXTS = [
    "checks / owner-decisions.md is append-only",
    "checks / A fix leaves its failing test alone",
    "checks / No credentials in the PR range",
    "checks / product.yaml is valid and a published product has its baseline",
    "checks / Cloudflare config stays inside the US$5 plan",
    "test",
]
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


class ReleaseEnforcement(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.outer = Path(self.tmp.name)
        self.repo = self.outer / "repo"
        self.repo.mkdir()
        self.state_path = self.outer / "state.json"
        self.log = self.outer / "calls.jsonl"
        self.bin = self.outer / "bin"
        self.bin.mkdir()
        for name in ("gh", "npm", "npx", "node"):
            path = self.bin / name
            path.write_text(FAKE)
            path.chmod(0o755)
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", FIXTURE_STATE=str(self.state_path), FIXTURE_LOG=str(self.log))
        for name in ("REQUIRED_CHECKS", "RELEASE_REQUIRED_CHECKS", "REVIEW_ON_HEAD_COMMENTS", "EXPECT_EXPENDITURE"):
            self.env.pop(name, None)
        self.env.update(CLOUDFLARE_API_TOKEN="fixture-token", CLOUDFLARE_ACCOUNT_ID="fixture-account", RTT_UPTIME_ACCESS_CLIENT_ID="fixture-id", RTT_UPTIME_ACCESS_CLIENT_SECRET="fixture-secret")
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        shutil.copytree(ROOT / ".ai-sdlc", self.repo / ".ai-sdlc")
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

    def comments(self, number):
        return self.state["api"][f"repos/{REPO}/issues/{number}/comments?per_page=100"]

    def pr(self, number, head, merge):
        info = {"number": number, "head": {"sha": head, "repo": {"full_name": REPO}}, "base": {"ref": "main"}, "state": "open", "draft": False, "body": "- Expenditure: none", "merged_at": "2026-10-18T09:00:00Z", "merge_commit_sha": merge}
        self.state["api"][f"repos/{REPO}/pulls/{number}"] = info
        self.state["api"][f"repos/{REPO}/commits/{merge}/pulls"] = [dict(info, state="closed")]
        self.state["api"][f"repos/{REPO}/issues/{number}/comments?per_page=100"] = [{"author_association": "OWNER", "body": f"VERDICT: APPROVE\nReviewed head: {head}\nStop: nothing\nExpenditure: none"}]
        self.state["api"][f"repos/{REPO}/commits/{head}/check-runs?per_page=100"] = {"total_count": len(CONTEXTS), "check_runs": [{"id": i + 1, "name": name, "status": "completed", "conclusion": "success"} for i, name in enumerate(CONTEXTS)]}

    def save(self):
        self.state_path.write_text(json.dumps(self.state))

    def run_script(self, name, *args):
        self.save()
        return subprocess.run([sys.executable, str(self.repo / "scripts" / name), *args], cwd=self.repo, env=self.env, text=True, capture_output=True)

    def release(self, *args):
        return self.run_script("web-release.py", self.sha, *args)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def merged(self):
        return any(call[:3] == ["gh", "pr", "merge"] for call in self.calls())

    def applied(self):
        return any(call[0] == "npx" and "deploy" in call and "--dry-run" not in call for call in self.calls())

    def test_preflight_checks_every_green_merge_including_transition_without_deploying(self):
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        endpoints = [call[2] for call in self.calls() if call[:2] == ["gh", "api"]]
        for sha in (self.transition, self.sha):
            self.assertIn(f"repos/{REPO}/commits/{sha}/pulls", endpoints)
        self.assertFalse(self.applied())

    def test_unreviewed_green_transition_holds_even_when_head_is_reviewed(self):
        self.comments(41).clear()
        result = self.release("--apply")
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertIn("APPROVE", result.stderr + result.stdout)
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

    def test_trusted_revoke_and_outsider_approval_cannot_release(self):
        head = self.info(42)["head"]["sha"]
        self.comments(42).extend([{"author_association": "MEMBER", "body": f"VERDICT: REQUEST CHANGES\nReviewed head: {head}"}, {"author_association": "NONE", "body": f"VERDICT: APPROVE\nReviewed head: {head}"}])
        result = self.release("--apply")
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertFalse(self.applied())

    def test_external_comment_override_is_ignored_and_outsider_rejection_cannot_hold(self):
        override = self.outer / "comments"
        override.write_text(f"VERDICT: REQUEST CHANGES\nReviewed head: {'b' * 40}\x1e")
        self.env["REVIEW_ON_HEAD_COMMENTS"] = str(override)
        self.comments(42).append({"author_association": "NONE", "body": f"VERDICT: REQUEST CHANGES\nReviewed head: {'b' * 40}"})
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_comment_metadata_or_fetch_failure_is_error_and_cannot_apply(self):
        key = f"repos/{REPO}/issues/42/comments?per_page=100"
        for data in ([{"body": "approval without API metadata"}], {"__error": True}):
            self.state["api"][key] = data
            result = self.release("--apply")
            self.assertEqual(result.returncode, 2, result.stderr + result.stdout)
            self.assertFalse(self.applied())

    def test_cloud_pass_covers_queued_but_never_completed_red(self):
        head = self.info(42)["head"]["sha"]
        runs = self.state["api"][f"repos/{REPO}/commits/{head}/check-runs?per_page=100"]["check_runs"]
        runs[0].update(status="queued", conclusion=None)
        self.comments(42).append({"author_association": "MEMBER", "body": f"CLOUD-CI: PASS\nTested head: {head}"})
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        runs[0].update(status="completed", conclusion="failure")
        result = self.release("--apply")
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertFalse(self.applied())

    def test_latest_cloud_fail_holds_even_all_check_runs_green(self):
        head = self.info(42)["head"]["sha"]
        self.comments(42).extend({"author_association": "MEMBER", "body": f"CLOUD-CI: {verdict}\nTested head: {head}"} for verdict in ("PASS", "FAIL"))
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

    def test_auto_merge_holds_fork_wrong_base_spend_stop_stale_review_or_closed(self):
        info = self.info(42)
        original = json.loads(json.dumps(info))
        review = self.comments(42)[0]["body"]
        for mutation in ("fork", "base", "spend", "stop", "stale", "closed"):
            with self.subTest(mutation=mutation):
                info.clear(); info.update(json.loads(json.dumps(original)))
                self.comments(42)[0]["body"] = review
                if mutation == "fork": info["head"]["repo"]["full_name"] = "outsider/repo"
                if mutation == "base": info["base"]["ref"] = "other"
                if mutation == "spend": info["body"] = "- Expenditure: proposed"
                if mutation == "stop": self.comments(42)[0]["body"] = review.replace("Stop: nothing", "Stop: merge")
                if mutation == "stale": self.comments(42)[0]["body"] = review.replace("b" * 40, "c" * 40)
                if mutation == "closed": info["state"] = "closed"
                result = self.run_script("auto-merge.py")
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertFalse(self.merged())

    def test_auto_merge_latest_trusted_revocation_holds_despite_outsider_spoof(self):
        head = "b" * 40
        self.comments(42).extend([{"author_association": "COLLABORATOR", "body": f"VERDICT: REQUEST CHANGES\nReviewed head: {head}"}, {"author_association": "NONE", "body": f"VERDICT: APPROVE\nReviewed head: {head}\nStop: nothing\nExpenditure: none"}])
        result = self.run_script("auto-merge.py")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertFalse(self.merged())

    def test_auto_merge_completed_red_never_uses_cloud_pass(self):
        head = "b" * 40
        self.state["api"][f"repos/{REPO}/commits/{head}/check-runs?per_page=100"]["check_runs"][0]["conclusion"] = "failure"
        self.comments(42).append({"author_association": "OWNER", "body": f"CLOUD-CI: PASS\nTested head: {head}"})
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
