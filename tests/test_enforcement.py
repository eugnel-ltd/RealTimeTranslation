"""Check the public loader caller and unchanged upstream release evidence."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / '.github/workflows'
CALLER = WORKFLOWS / 'ai-sdlc-checks.yml'
LEGACY_WORKFLOW = 'ai-sdlc-checks' + '-impl.yml'


class EnforcementTests(unittest.TestCase):
    def caller(self):
        return yaml.safe_load(CALLER.read_text())

    def test_caller_uses_exact_trusted_events(self):
        caller = self.caller()
        events = caller.get('on', caller.get(True))
        self.assertEqual(events, {
            'pull_request_target': {'types': ['opened', 'synchronize', 'reopened']},
            'issue_comment': {'types': ['created', 'edited', 'deleted']},
        })

    def test_caller_grants_oidc_and_status_permissions(self):
        permissions = self.caller()['permissions']
        self.assertEqual(permissions['id-token'], 'write')
        self.assertEqual(permissions['statuses'], 'write')

    def test_caller_invokes_public_loader(self):
        invocation = self.caller()['jobs']['checks']
        self.assertEqual(invocation['uses'],
                         'eugnel-ltd/ai-sdlc-loader/.github/workflows/checks.yml@v3')
        self.assertEqual(invocation['with']['base'], 'main')
        self.assertEqual(json.loads(invocation['with']['runs_on']), ['ubuntu-latest'])

    def test_comment_filter_has_no_permissions(self):
        self.assertEqual(self.caller()['jobs']['comment-filter']['permissions'], {})

    def test_all_workflows_avoid_self_hosted_runners(self):
        for path in WORKFLOWS.rglob('*'):
            if path.suffix not in ('.yml', '.yaml'):
                continue
            workflow = yaml.safe_load(path.read_text())
            for name, job in workflow.get('jobs', {}).items():
                with self.subTest(workflow=path.name, job=name):
                    self.assertNotIn('self-hosted', str(job.get('runs-on', '')))

    def test_vendored_workflow_is_absent_and_unreferenced(self):
        self.assertFalse((WORKFLOWS / LEGACY_WORKFLOW).exists())
        for path in WORKFLOWS.rglob('*'):
            if path.is_file():
                with self.subTest(workflow=path.name):
                    self.assertNotIn(LEGACY_WORKFLOW, path.read_text())

    def test_upstream_release_evidence(self):
        for prerequisite in ('bash', 'git', 'jq', 'python3'):
            self.assertIsNotNone(shutil.which(prerequisite),
                                 f'{prerequisite} is required for executable upstream checks')
        with tempfile.TemporaryDirectory(prefix='rtt-upstream-checks-') as temporary:
            directory = Path(temporary)
            for subdir in ('tests', 'scripts'):
                (directory / subdir).mkdir()
            for name in ('review_on_head.sh', 'head_checks.sh', 'release_evidence.sh'):
                shutil.copyfile(ROOT / '.ai-sdlc' / name, directory / 'scripts' / name)
            name = 'test_release_evidence.sh'
            script = directory / 'tests' / name
            shutil.copyfile(ROOT / 'tests/ai-sdlc-upstream' / name, script)
            result = subprocess.run(['sh', str(script)], cwd=directory, text=True,
                                    capture_output=True, check=False)
            output = result.stdout + result.stderr
            self.assertEqual(result.returncode, 0, output)
            self.assertNotIn('skip:', output, 'upstream evidence must execute, not skip')
            self.assertIn('ok ', result.stdout)

    def test_vendored_assets_match_recorded_upstream_provenance(self):
        record = json.loads((ROOT / '.ai-sdlc/upstream.json').read_text())
        self.assertEqual(record['revision'], 'b217812bca40c0b3d3ff1ba012ed8c4e33ee2636')
        for asset in record['files']:
            with self.subTest(asset=asset['installed']):
                path = ROOT / asset['installed']
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),
                                 asset['installed_sha256'])
                self.assertEqual(asset['installed_sha256'], asset['source_sha256'],
                                 'adopted scripts/tests must remain unchanged upstream copies')


if __name__ == '__main__':
    unittest.main()
