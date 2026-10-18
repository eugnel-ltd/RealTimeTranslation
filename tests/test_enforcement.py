"""Exercise the local trusted-base workflow and the unchanged upstream check tests."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
CALLER = ROOT / '.github/workflows/ai-sdlc-checks.yml'
IMPLEMENTATION = ROOT / '.github/workflows/ai-sdlc-checks-impl.yml'
UPSTREAM_TESTS = ('test_checks_step.sh', 'test_checks_fetch.sh', 'test_release_evidence.sh')


def run(*args, cwd=None, env=None):
    return subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True, check=False)


class EnforcementTests(unittest.TestCase):
    def workflow(self):
        self.assertTrue(IMPLEMENTATION.is_file(), 'local trusted-base PR check implementation must exist')
        return yaml.safe_load(IMPLEMENTATION.read_text())

    def step(self, job):
        return next(step['run'] for step in self.workflow()['jobs'][job]['steps'] if 'run' in step)

    def test_public_caller_invokes_local_workflow_with_trusted_events(self):
        self.assertTrue(CALLER.is_file(), 'public RTT needs a local PR-check caller instead of a private reusable dependency')
        caller = yaml.safe_load(CALLER.read_text())
        events = caller.get('on', caller.get(True))
        self.assertEqual(set(events), {'pull_request_target', 'issue_comment'})
        self.assertEqual(set(events['issue_comment']['types']), {'created', 'edited', 'deleted'})
        invocation = caller['jobs']['checks']
        self.assertEqual(invocation['uses'], './.github/workflows/ai-sdlc-checks-impl.yml')
        self.assertTrue((ROOT / invocation['uses']).is_file())
        self.assertEqual(invocation['with']['base'], 'main')
        self.assertEqual(json.loads(invocation['with']['runs_on']), ['self-hosted', 'ai-sdlc'])
        workflow = self.workflow()
        self.assertEqual(set(workflow['jobs']), {
            'resolve', 'review-on-head', 'owner-decisions', 'locked-tests',
            'secret-scan', 'manifest', 'cloudflare-cost',
        })
        for job in workflow['jobs'].values():
            self.assertEqual(job['runs-on'], '${{ fromJSON(inputs.runs_on) }}')
            for step in job.get('steps', []):
                if 'uses' in step:
                    self.assertEqual(step['uses'], 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262')
                    self.assertEqual(step['with']['ref'], 'main')
                    self.assertIs(step['with']['persist-credentials'], False)

    def git_fixture(self, directory, include_base_checker):
        origin = directory / 'origin'
        runner = directory / 'runner'
        def git(*args, cwd=origin):
            result = run('git', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', *args, cwd=cwd)
            self.assertEqual(result.returncode, 0, result.stderr)
            return result.stdout.strip()
        directory.mkdir(parents=True, exist_ok=True)
        self.assertEqual(run('git', 'init', '-q', '-b', 'main', str(origin)).returncode, 0)
        (origin / '.ai-sdlc').mkdir()
        if include_base_checker:
            (origin / '.ai-sdlc/owner_decisions_check.sh').write_text('touch "$BASE_SENTINEL"\nexit 0\n')
        (origin / 'base.txt').write_text('trusted base\n')
        git('add', '.')
        git('commit', '-qm', 'trusted base')
        base = git('rev-parse', 'HEAD')
        git('switch', '-qc', 'malicious-head')
        (origin / '.ai-sdlc/owner_decisions_check.sh').write_text('touch "$HEAD_SENTINEL"\nexit 0\n')
        (origin / 'payload.sh').write_text('touch "$HEAD_SENTINEL"\n')
        git('add', '.')
        git('commit', '-qm', 'untrusted head checker')
        git('update-ref', 'refs/pull/1/head', 'HEAD')
        git('switch', '-q', 'main')
        self.assertEqual(run('git', 'clone', '-q', str(origin), str(runner)).returncode, 0)
        return runner, base

    def execute_owner_step(self, include_base_checker):
        shell = self.step('owner-decisions')
        with tempfile.TemporaryDirectory(prefix='rtt-trusted-checks-') as temporary:
            directory = Path(temporary)
            runner, base = self.git_fixture(directory, include_base_checker)
            base_sentinel = directory / 'base-ran'
            head_sentinel = directory / 'head-ran'
            env = {
                **os.environ, 'BASE': 'main', 'PR': '1', 'SCRIPTS': '.ai-sdlc',
                'RUNNER_TEMP': str(directory), 'BASE_SENTINEL': str(base_sentinel),
                'HEAD_SENTINEL': str(head_sentinel),
            }
            result = run('bash', '-e', '-c', shell, cwd=runner, env=env)
            self.assertEqual(run('git', 'rev-parse', 'HEAD', cwd=runner).stdout.strip(), base,
                             'the workflow must retain the trusted base checkout')
            self.assertFalse(head_sentinel.exists(), 'the PR checker and payload must never execute')
            if include_base_checker:
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertTrue(base_sentinel.exists(), 'the checker must execute from origin/main')
            else:
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertIn('is not on main', result.stdout + result.stderr)
                self.assertFalse(base_sentinel.exists())

    def test_malicious_head_checker_is_data_and_base_checker_executes(self):
        self.execute_owner_step(include_base_checker=True)

    def test_missing_base_checker_fails_instead_of_running_head_copy(self):
        self.execute_owner_step(include_base_checker=False)

    def test_upstream_executable_step_fetch_and_release_evidence_tests(self):
        self.workflow()
        for prerequisite in ('bash', 'git', 'jq', 'python3'):
            self.assertIsNotNone(shutil.which(prerequisite), f'{prerequisite} is required for executable upstream checks')
        with tempfile.TemporaryDirectory(prefix='rtt-upstream-checks-') as temporary:
            directory = Path(temporary)
            for subdir in ('tests', 'scripts', '.github/workflows'):
                (directory / subdir).mkdir(parents=True)
            shutil.copyfile(IMPLEMENTATION, directory / '.github/workflows/checks.yml')
            for name in ('review_on_head.sh', 'head_checks.sh', 'release_evidence.sh'):
                source = ROOT / '.ai-sdlc' / name
                self.assertTrue(source.is_file(), f'upstream evidence helper missing: {name}')
                shutil.copyfile(source, directory / 'scripts' / name)
            for name in UPSTREAM_TESTS:
                with self.subTest(upstream=name):
                    shutil.copyfile(ROOT / 'tests/ai-sdlc-upstream' / name, directory / 'tests' / name)
                    result = run('sh', str(directory / 'tests' / name), cwd=directory)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertNotIn('skip:', result.stdout, 'upstream evidence must execute, not skip')
                    self.assertIn('ok ', result.stdout)

    def test_vendored_assets_match_recorded_upstream_provenance(self):
        provenance = ROOT / '.ai-sdlc/upstream.json'
        self.assertTrue(provenance.is_file(), 'vendored controls need their upstream revision and hashes')
        record = json.loads(provenance.read_text())
        self.assertEqual(record['revision'], 'b217812bca40c0b3d3ff1ba012ed8c4e33ee2636')
        for asset in record['files']:
            with self.subTest(asset=asset['installed']):
                path = ROOT / asset['installed']
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), asset['installed_sha256'])
                if asset['installed'] != '.github/workflows/ai-sdlc-checks-impl.yml':
                    self.assertEqual(asset['installed_sha256'], asset['source_sha256'], 'adopted scripts/tests must remain unchanged upstream copies')


if __name__ == '__main__':
    unittest.main()
