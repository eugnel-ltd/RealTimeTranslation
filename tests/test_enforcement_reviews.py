"""Public issue comments cannot grant or revoke the trusted review gate."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
HEAD = '0123456789abcdef0123456789abcdef01234567'


def review(verdict, association):
    return {'author_association': association, 'body': f'VERDICT: {verdict}\nReviewed head: {HEAD}'}


class PublicReviewTrustTests(unittest.TestCase):
    def execute(self, comments, fetch_failure=False):
        workflow = yaml.safe_load((ROOT / '.github/workflows/ai-sdlc-checks-impl.yml').read_text())
        step = next(item['run'] for item in workflow['jobs']['review-on-head']['steps'] if 'run' in item)
        with tempfile.TemporaryDirectory(prefix='rtt-review-trust-') as temporary:
            directory = Path(temporary)
            binaries = directory / 'bin'
            binaries.mkdir()
            (directory / 'comments.json').write_text(json.dumps(comments))
            shutil.copyfile(ROOT / '.ai-sdlc/review_on_head.sh', directory / 'base-review.sh')
            (binaries / 'git').write_text('''#!/bin/sh
case "$1" in
  fetch) exit 0 ;;
  show) cat "$BASE_REVIEW" ;;
  *) exit 1 ;;
esac
''')
            (binaries / 'gh').write_text('''#!/usr/bin/env python3
import json, os, subprocess, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ['GH_TRACE'], 'a') as trace:
    trace.write(json.dumps(args) + '\\n')
if any('/comments?' in value for value in args):
    if os.environ['FETCH_FAILURE'] == '1':
        sys.exit(1)
    expression = args[args.index('--jq') + 1]
    completed = subprocess.run(['jq', '-r', expression, os.environ['COMMENTS_FILE']], check=False)
    sys.exit(completed.returncode)
if any('/statuses/' in value for value in args):
    sys.exit(0)
sys.exit(2)
''')
            for binary in binaries.iterdir():
                binary.chmod(0o755)
            env = {
                **os.environ, 'PATH': str(binaries) + os.pathsep + os.environ['PATH'],
                'GH_TRACE': str(directory / 'gh.jsonl'), 'COMMENTS_FILE': str(directory / 'comments.json'),
                'BASE_REVIEW': str(directory / 'base-review.sh'), 'FETCH_FAILURE': str(int(fetch_failure)),
                'RUNNER_TEMP': str(directory), 'GH_TOKEN': 'fixture', 'PR': '1', 'HEAD': HEAD,
                'BASE': 'main', 'SCRIPTS': '.ai-sdlc', 'GITHUB_REPOSITORY': 'fixture/repo',
                'RUN_URL': 'https://example.test/run',
            }
            env.pop('REVIEW_ON_HEAD_COMMENTS', None)
            result = subprocess.run(['bash', '-e', '-c', step], cwd=directory, env=env,
                                    text=True, capture_output=True, check=False)
            calls = [json.loads(line) for line in (directory / 'gh.jsonl').read_text().splitlines()]
            statuses = [call for call in calls if any('/statuses/' in value for value in call)]
            self.assertEqual(len(statuses), 1, 'every review outcome must attempt an exact-head status write')
            self.assertIn(f'repos/fixture/repo/statuses/{HEAD}', statuses[0])
            return result, statuses[0]

    def test_outsider_approval_cannot_override_trusted_rejection(self):
        result, status = self.execute([review('REQUEST CHANGES', 'MEMBER'), review('APPROVE', 'NONE')])
        self.assertEqual(result.returncode, 1, 'an outsider must not turn a trusted rejection into approval')
        self.assertIn('state=failure', status)

    def test_outsider_rejection_cannot_override_trusted_approval(self):
        result, status = self.execute([review('APPROVE', 'OWNER'), review('REQUEST CHANGES', 'CONTRIBUTOR')])
        self.assertEqual(result.returncode, 0, 'an outsider must not revoke a trusted approval')
        self.assertIn('state=success', status)

    def test_outsider_alone_cannot_supply_approval(self):
        result, status = self.execute([review('APPROVE', 'NONE')])
        self.assertEqual(result.returncode, 1, 'a public outsider cannot provide the required independent review')
        self.assertIn('state=failure', status)

    def test_comment_fetch_failure_attempts_error_status(self):
        result, status = self.execute([review('APPROVE', 'OWNER')], fetch_failure=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('state=error', status)
        self.assertNotIn('state=success', status)

    def test_malformed_comment_metadata_attempts_error_status(self):
        result, status = self.execute([{'body': f'VERDICT: APPROVE\nReviewed head: {HEAD}'}])
        self.assertEqual(result.returncode, 2, 'missing trusted API metadata must fail closed')
        self.assertIn('state=error', status)


if __name__ == '__main__':
    unittest.main()
