"""A revoked review cannot retain success when fetching the trusted base fails."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]


class TrustedBaseFetchFailureTests(unittest.TestCase):
    def test_failed_base_fetch_attempts_an_error_status_under_bash_e(self):
        workflow = yaml.safe_load((ROOT / '.github/workflows/ai-sdlc-checks-impl.yml').read_text())
        step = next(item['run'] for item in workflow['jobs']['review-on-head']['steps'] if 'run' in item)
        with tempfile.TemporaryDirectory(prefix='rtt-base-fetch-failure-') as temporary:
            directory = Path(temporary)
            binaries = directory / 'bin'
            binaries.mkdir()
            (binaries / 'git').write_text('#!/bin/sh\nexit 128\n')
            (binaries / 'gh').write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$GH_TRACE"\nexit 0\n')
            for binary in binaries.iterdir():
                binary.chmod(0o755)
            trace = directory / 'gh.log'
            sha = '0123456789abcdef0123456789abcdef01234567'
            env = {
                **os.environ, 'PATH': str(binaries) + os.pathsep + os.environ['PATH'],
                'BASE': 'main', 'PR': '1', 'HEAD': sha, 'SCRIPTS': '.ai-sdlc',
                'RUNNER_TEMP': str(directory), 'GH_TRACE': str(trace),
                'GH_TOKEN': 'fixture', 'GITHUB_REPOSITORY': 'fixture/repo', 'RUN_URL': 'https://example.test/run',
            }
            result = subprocess.run(['bash', '-e', '-c', step], cwd=directory, env=env,
                                    text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 2, 'failed trusted-base fetch must reach the error-status path under bash -e')
            self.assertTrue(trace.is_file(), 'fetch failure must still attempt to replace any stale success status')
            calls = trace.read_text()
            self.assertIn(f'repos/fixture/repo/statuses/{sha}', calls)
            self.assertIn('state=error', calls)
            self.assertNotIn('state=success', calls)


if __name__ == '__main__':
    unittest.main()
