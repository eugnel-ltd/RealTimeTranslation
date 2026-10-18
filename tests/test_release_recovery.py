"""A provider transport failure after dispatch must still reconcile or recover."""
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
SPEC = importlib.util.spec_from_file_location("rtt_web_release", ROOT / "scripts/web-release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class RecoveryTransport(unittest.TestCase):
    def setUp(self):
        self.sha = "a" * 40
        self.capabilities = {name: "fixture" for name in (
            "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID",
            "RTT_UPTIME_ACCESS_CLIENT_ID", "RTT_UPTIME_ACCESS_CLIENT_SECRET",
        )}
        self.capabilities["GITHUB_ACTIONS"] = "false"

    def run_apply(self, fail_on):
        attempt = None

        def command(args, **_kwargs):
            nonlocal attempt
            if "deploy" in args and "--dry-run" not in args and "--tag" in args:
                attempt = args[args.index("--tag") + 1]
            if fail_on(args):
                raise release.Failure("transport deadline")
            if "versions" in args and "view" in args:
                return subprocess.CompletedProcess(args, 0, json.dumps({"id": "new-version", "annotations": {
                    "workers/tag": attempt, "workers/message": f"RTT source {self.sha}",
                }}), "")
            return subprocess.CompletedProcess(args, 0, "", "")

        with patch.dict(os.environ, self.capabilities), patch.object(release, "preflight"), \
                patch.object(release, "command", side_effect=command), \
                patch.object(release, "deployment", side_effect=[("old-deploy", "old-version"), ("new-deploy", "new-version"), ("new-deploy", "new-version")]) as evidence, \
                patch.object(release, "rollback") as rollback:
            with self.assertRaises(release.Hold):
                release.apply(self.sha)
            self.assertEqual(evidence.call_count, 3, "lost provider response must be reconciled and ownership freshly rechecked")
            rollback.assert_called_once_with("old-version")

    def test_lost_deploy_response_reads_provider_state_before_recovery(self):
        self.run_apply(lambda args: args[0] == "npx" and "deploy" in args and "--dry-run" not in args)

    def test_missing_health_receipt_recovers_the_new_deployment(self):
        self.run_apply(lambda args: args[0] == "node")


if __name__ == "__main__":
    unittest.main()
