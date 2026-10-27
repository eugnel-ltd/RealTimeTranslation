"""Check the public loader caller and the remaining vendored asset provenance."""
import hashlib
import json
from pathlib import Path
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
CALLER = ROOT / '.github/workflows/ai-sdlc-checks.yml'


class EnforcementTests(unittest.TestCase):
    def test_public_caller_invokes_loader_v3_with_trusted_events(self):
        self.assertTrue(CALLER.is_file(), 'public RTT needs the public loader caller')
        caller = yaml.safe_load(CALLER.read_text())
        events = caller.get('on', caller.get(True))
        self.assertEqual(events, {
            'pull_request_target': {
                'types': ['opened', 'synchronize', 'reopened', 'ready_for_review'],
            },
            'issue_comment': {'types': ['created', 'edited', 'deleted']},
        })
        self.assertEqual(set(caller['jobs']), {'checks'})
        invocation = caller['jobs']['checks']
        self.assertEqual(invocation['uses'],
                         'eugnel-ltd/ai-sdlc-loader/.github/workflows/checks.yml@v3')
        self.assertEqual(invocation['with'], {'base': 'main'})
        for key in ('runs_on', 'runs-on', 'secrets'):
            self.assertNotIn(key, invocation)
            self.assertNotIn(key, invocation['with'])
        self.assertEqual(caller['permissions'], {
            'contents': 'read',
            'pull-requests': 'read',
            'issues': 'read',
            'statuses': 'write',
            'id-token': 'write',
        })

    def test_local_workflow_copy_is_absent(self):
        workflows = sorted(CALLER.parent.glob('ai-sdlc-checks*'))
        self.assertEqual(workflows, [CALLER], 'only the public loader caller must remain')

    def test_vendored_assets_match_recorded_upstream_provenance(self):
        provenance = ROOT / '.ai-sdlc/upstream.json'
        self.assertTrue(provenance.is_file(), 'vendored controls need their upstream revision and hashes')
        record = json.loads(provenance.read_text())
        self.assertEqual(record['revision'], 'b217812bca40c0b3d3ff1ba012ed8c4e33ee2636')
        for asset in record['files']:
            with self.subTest(asset=asset['installed']):
                path = ROOT / asset['installed']
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), asset['installed_sha256'])
                self.assertEqual(asset['installed_sha256'], asset['source_sha256'], 'adopted scripts/tests must remain unchanged upstream copies')


if __name__ == '__main__':
    unittest.main()
