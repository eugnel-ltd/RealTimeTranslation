"""Check the public loader caller and unchanged upstream release evidence."""
import hashlib
import json
from pathlib import Path
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

    def test_vendored_assets_match_recorded_upstream_provenance(self):
        record = json.loads((ROOT / '.ai-sdlc/upstream.json').read_text())
        self.assertNotIn('revision', record)
        self.assertEqual(record['repository'], 'https://github.com/eugnel-ltd/ai-sdlc')
        self.assertEqual(record['adaptations'], {})
        expected = {'review_on_head.sh', 'head_checks.sh', 'release_evidence.sh',
                    'release_remediation.sh', 'manifest_check.py'}
        self.assertEqual({Path(asset['installed']).name for asset in record['files']}, expected)
        self.assertEqual(len(record['files']), len(expected))
        self.assertEqual({path.name for path in (ROOT / '.ai-sdlc').iterdir()},
                         expected | {'upstream.json'})
        for asset in record['files']:
            with self.subTest(asset=asset['installed']):
                name = Path(asset['installed']).name
                revision = ('b217812bca40c0b3d3ff1ba012ed8c4e33ee2636' if name == 'manifest_check.py'
                            else '38b1afbb1968e927e995c7c9af57fb7c35fa24f1')
                self.assertEqual(asset['revision'], revision)
                self.assertEqual(asset['installed'], f'.ai-sdlc/{name}')
                self.assertEqual(asset['source'], f'scripts/{name}')
                path = ROOT / asset['installed']
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),
                                 asset['installed_sha256'])
                self.assertEqual(asset['installed_sha256'], asset['source_sha256'],
                                 'adopted helpers must remain unchanged upstream copies')


if __name__ == '__main__':
    unittest.main()
