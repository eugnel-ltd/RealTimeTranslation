"""An unrelated active deployment is never a rollback target or our receipt."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("rtt_release_ownership", ROOT / "scripts/web-release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleaseOwnership(unittest.TestCase):
    def exercise(self, *, lost=False, health_failed=False, after_health=False, same_source=False):
        expected = "a" * 40
        attempt = None

        def command(args, **_kwargs):
            nonlocal attempt
            if "deploy" in args and "--dry-run" not in args:
                if "--tag" in args:
                    attempt = args[args.index("--tag") + 1]
                return subprocess.CompletedProcess(args, 1 if lost else 0, "", "")
            if "versions" in args and "view" in args:
                version = args[args.index("view") + 1]
                annotations = {"workers/tag": attempt if version == "own-version" else "another-attempt",
                               "workers/message": f"RTT source {expected if same_source or version == 'own-version' else 'b' * 40}"}
                return subprocess.CompletedProcess(args, 0, json.dumps({"id": version, "annotations": annotations}), "")
            if args[0] == "node":
                return subprocess.CompletedProcess(args, 1 if health_failed else 0, json.dumps({"healthy": True, "exitCode": 0}), "")
            return subprocess.CompletedProcess(args, 0, "", "")

        states = [("old-deployment", "prior-version")]
        if lost:
            states.append(("unrelated-deployment", "foreign-version"))
        else:
            states.extend([("our-deployment", "own-version"), ("unrelated-deployment", "foreign-version")])
        capabilities = {name: "fixture" for name in (
            "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID",
            "RTT_UPTIME_ACCESS_CLIENT_ID", "RTT_UPTIME_ACCESS_CLIENT_SECRET",
        )}
        capabilities["GITHUB_ACTIONS"] = "false"
        with patch.dict(os.environ, capabilities), patch.object(release, "preflight"), \
                patch.object(release, "command", side_effect=command), \
                patch.object(release, "deployment", side_effect=states), patch.object(release, "rollback") as rollback:
            with self.assertRaisesRegex(release.Failure, "UNKNOWN"):
                release.apply(expected)
            rollback.assert_not_called()

    def test_failed_submission_cannot_undo_unrelated_concurrent_deployment(self):
        self.exercise(lost=True)

    def test_same_source_from_another_attempt_does_not_establish_ownership(self):
        self.exercise(lost=True, same_source=True)

    def test_intervening_release_is_not_undone_on_failed_health(self):
        self.exercise(health_failed=True)

    def test_intervening_release_prevents_claiming_our_healthy_version_is_current(self):
        self.exercise(after_health=True)


if __name__ == "__main__":
    unittest.main()
