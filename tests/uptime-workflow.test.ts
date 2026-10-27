import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

interface WorkflowStep {
  id?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string | boolean>;
}

interface Workflow {
  on: { schedule: Array<{ cron: string }>; workflow_dispatch: unknown };
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: { uptime: { if: string; 'runs-on': string[]; 'timeout-minutes': number; steps: WorkflowStep[] } };
  env?: Record<string, string>;
}

const project = fileURLToPath(new URL('..', import.meta.url));
const temporary: string[] = [];
function scratch() {
  const directory = mkdtempSync(resolve(tmpdir(), 'rtt-uptime-workflow-'));
  temporary.push(directory);
  return directory;
}
function workflow(): Workflow {
  return parse(readFileSync(new URL('../.github/workflows/uptime.yml', import.meta.url), 'utf8')) as Workflow;
}

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('trusted scheduled uptime workflow', () => {
  it('permits only scheduled or manually dispatched default-branch runs on a GitHub-hosted runner', () => {
    const config = workflow();
    expect(Object.keys(config.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(config.on.schedule).toEqual([{ cron: '7,37 * * * *' }]);
    expect(config.permissions).toEqual({ contents: 'read', issues: 'write' });
    expect(config.concurrency['cancel-in-progress']).toBe(false);
    expect(config.jobs.uptime['runs-on']).toEqual('ubuntu-latest');
    expect(config.jobs.uptime['timeout-minutes']).toBeLessThanOrEqual(5);
    const allowed = new Function('github', 'format', 'vars', `return (${config.jobs.uptime.if});`) as
      (github: object, format: (pattern: string, value: string) => string, vars: Record<string, string>) => boolean;
    for (const [event, branch, expected] of [
      ['schedule', 'main', true], ['workflow_dispatch', 'main', true],
      ['pull_request', 'main', false], ['pull_request_target', 'main', false],
      ['workflow_dispatch', 'feature', false], ['schedule', 'feature', false],
    ] as const) {
      for (const enabled of [false, true]) {
        expect(allowed({ event_name: event, ref: `refs/heads/${branch}`, event: { repository: { default_branch: 'main' } } },
          (pattern, value) => pattern.replace('{0}', value), { RTT_UPTIME_ENABLED: String(enabled) })).toBe(expected && enabled);
      }
    }
    const checkout = config.jobs.uptime.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.ref).toBe('${{ github.event.repository.default_branch }}');
    expect(checkout?.with?.['persist-credentials']).toBe(false);
    expect(config.env).toBeUndefined();
    const credentialSteps = config.jobs.uptime.steps.filter((step) => Object.values(step.env ?? {}).some((value) => value.includes('secrets.CF_ACCESS_CLIENT')));
    expect(credentialSteps.map((step) => step.id)).toEqual(['check']);
    expect(credentialSteps[0].env).toEqual({
      RTT_UPTIME_ACCESS_CLIENT_ID: '${{ secrets.CF_ACCESS_CLIENT_ID }}',
      RTT_UPTIME_ACCESS_CLIENT_SECRET: '${{ secrets.CF_ACCESS_CLIENT_SECRET }}',
    });
  });

  it('executes the workflow check shell and preserves unconfigured exit 2 for its final step', () => {
    const steps = workflow().jobs.uptime.steps;
    const check = steps.find((step) => step.id === 'check');
    const directory = scratch();
    const outputFile = resolve(directory, 'outputs');
    const checked = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', check?.run ?? 'exit 99'], {
      cwd: project, encoding: 'utf8',
      env: { PATH: process.env.PATH, RUNNER_TEMP: directory, GITHUB_OUTPUT: outputFile, RTT_UPTIME_ACCESS_CLIENT_ID: '', RTT_UPTIME_ACCESS_CLIENT_SECRET: '' },
    });
    expect(checked.status).toBe(0);
    expect(JSON.parse(checked.stdout)).toMatchObject({ configured: false, exitCode: 2 });
    expect(readFileSync(outputFile, 'utf8')).toBe('rc=2\n');
    const final = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', steps.at(-1)?.run ?? 'exit 99'], {
      encoding: 'utf8', env: { CHECK_RC: '2' },
    });
    expect(final.status).toBe(2);
  });

  it('runs the actual workflow incident script offline through outage, deduplication, unconfigured hold and recovery', () => {
    const step = workflow().jobs.uptime.steps.find((candidate) => candidate.uses?.startsWith('actions/github-script@'));
    const directory = scratch();
    const runner = resolve(directory, 'incident-runner.mjs');
    const script = String(step?.with?.script);
    // Run under real Node: Vitest's VM does not provide the dynamic-import
    // callback used by the production github-script action.
    writeFileSync(runner, `
      import { writeFileSync } from 'node:fs';
      import { resolve } from 'node:path';
      const state = { reads: 0, creates: 0, comments: 0, closes: 0, network: 0, errors: [], actions: [] };
      globalThis.fetch = async () => { state.network++; throw new Error('Offline test forbids network'); };
      const open = [];
      const issues = {
        listForRepo() {},
        async create(parameters) { state.creates++; open.push({ number: 71, user: { login: 'github-actions[bot]', type: 'Bot' }, ...parameters }); },
        async createComment() { state.comments++; },
        async update() { state.closes++; open.splice(0); },
      };
      const github = { rest: { issues }, async paginate() { state.reads++; return [...open]; } };
      const core = { info(value) { state.actions.push(JSON.parse(value).action); }, setFailed(message) { state.errors.push(message); } };
      const execute = new Function('github', 'context', 'core', ${JSON.stringify(`return (async () => {${script}})();`)});
      async function run(result) {
        writeFileSync(resolve(process.env.RUNNER_TEMP, 'rtt-uptime.json'), JSON.stringify(result));
        await execute(github, { repo: { owner: 'eugnel-ltd', repo: 'RealTimeTranslation' } }, core);
      }
      await run({ configured: true, healthy: false, exitCode: 1 });
      await run({ configured: true, healthy: false, exitCode: 1 });
      state.readsBeforeUnconfigured = state.reads;
      await run({ configured: false, healthy: false, exitCode: 2 });
      state.readsAfterUnconfigured = state.reads;
      state.openAfterUnconfigured = open.length;
      await run({ configured: true, healthy: true, exitCode: 0 });
      state.finalOpen = open.length;
      console.log(JSON.stringify(state));
    `);
    const proof = spawnSync(process.execPath, [runner], {
      cwd: project, encoding: 'utf8',
      env: { PATH: process.env.PATH, GITHUB_WORKSPACE: project, RUNNER_TEMP: directory, RUN_URL: 'https://github.com/eugnel-ltd/RealTimeTranslation/actions/runs/123' },
    });
    expect(proof.status).toBe(0);
    expect(proof.stderr).toBe('');
    expect(JSON.parse(proof.stdout)).toEqual({
      reads: 3, creates: 1, comments: 1, closes: 1, network: 0, errors: [],
      actions: ['opened', 'existing', 'unconfigured', 'recovered'],
      readsBeforeUnconfigured: 2, readsAfterUnconfigured: 2, openAfterUnconfigured: 1, finalOpen: 0,
    });
  });

  it.each([true, false])('returns the correct actual CLI exit for configured healthy=%s without network', (healthy) => {
    const directory = scratch();
    const preload = resolve(directory, 'offline-fetch.mjs');
    writeFileSync(preload, `globalThis.fetch = async (url, init) => {
      if (new URL(String(url)).origin !== 'https://rtt.eugnel.com' || init.redirect !== 'manual') throw new Error('Unexpected request');
      return String(url).endsWith('/api/healthz')
        ? new Response(JSON.stringify({ status: '${healthy ? 'ok' : 'fail'}' }), { status: ${healthy ? 200 : 503} })
        : new Response('<html>RTT</html>');
    };`);
    const result = spawnSync(process.execPath, ['--import', preload, 'scripts/uptime.mjs'], {
      cwd: project, encoding: 'utf8',
      env: { PATH: process.env.PATH, RTT_UPTIME_ACCESS_CLIENT_ID: 'offline-test', RTT_UPTIME_ACCESS_CLIENT_SECRET: 'offline-secret' },
    });
    expect(result.status).toBe(healthy ? 0 : 1);
    expect(JSON.parse(result.stdout)).toMatchObject({ configured: true, healthy, exitCode: healthy ? 0 : 1 });
    expect(result.stdout).not.toContain('offline-secret');
    expect(result.stderr).toBe('');
  });
});
