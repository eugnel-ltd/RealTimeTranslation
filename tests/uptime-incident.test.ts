import { describe, expect, it, vi } from 'vitest';
import type { UptimeResult } from '../scripts/uptime.mjs';

const manageIncident: typeof import('../scripts/uptime-incident.mjs').manageIncident = async (...args) =>
  (await import('../scripts/uptime-incident.mjs')).manageIncident(...args);

const title = 'Uptime: rtt.eugnel.com is failing';
const marker = '<!-- rtt-uptime-incident -->';
const failed: UptimeResult = { configured: true, healthy: false, exitCode: 1, checks: {} };
const healthy: UptimeResult = { configured: true, healthy: true, exitCode: 0, checks: {} };
const owner = 'eugnel-ltd';
const repo = 'RealTimeTranslation';

function offlineGitHub(initial: Array<{ number: number; title: string; body?: string; pull_request?: unknown; user?: { login: string; type: string } }> = []) {
  const open = [...initial];
  const issues = {
    listForRepo: vi.fn(),
    create: vi.fn(async (parameters: { title: string; body: string }) => {
      open.push({ number: 1001, user: { login: 'github-actions[bot]', type: 'Bot' }, ...parameters });
      return {};
    }),
    createComment: vi.fn(async () => ({})),
    update: vi.fn(async (parameters: { issue_number: number }) => {
      const index = open.findIndex((issue) => issue.number === parameters.issue_number);
      if (index >= 0) open.splice(index, 1);
      return {};
    }),
  };
  return { paginate: vi.fn(async () => [...open]), rest: { issues } };
}

describe('offline uptime incident lifecycle', () => {
  it('opens one incident for repeated failed runs and closes it on authenticated recovery', async () => {
    const github = offlineGitHub();
    expect(await manageIncident({ result: failed, github, owner, repo })).toEqual({ action: 'opened', count: 1 });
    expect(await manageIncident({ result: failed, github, owner, repo })).toEqual({ action: 'existing', count: 1 });
    expect(github.rest.issues.create).toHaveBeenCalledTimes(1);
    expect(await manageIncident({ result: healthy, github, owner, repo })).toEqual({ action: 'recovered', count: 1 });
    expect(github.rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.update).toHaveBeenCalledWith({ owner, repo, issue_number: 1001, state: 'closed', state_reason: 'completed' });
    expect(await manageIncident({ result: healthy, github, owner, repo })).toEqual({ action: 'healthy', count: 0 });
  });

  it('makes no GitHub requests when credentials are unconfigured, including when an incident is already open', async () => {
    const github = offlineGitHub([{ number: 1, title, body: marker }]);
    const result: UptimeResult = { configured: false, healthy: false, exitCode: 2, reason: 'missing_credentials', checks: {} };
    expect(await manageIncident({ result, github, owner, repo })).toEqual({ action: 'unconfigured', count: 0 });
    expect(github.paginate).not.toHaveBeenCalled();
    expect(github.rest.issues.create).not.toHaveBeenCalled();
    expect(github.rest.issues.update).not.toHaveBeenCalled();
  });

  it('uses a paginated issue listing and ignores unrelated titles, missing markers and pull requests', async () => {
    const github = offlineGitHub([
      { number: 1, title: 'Other failure', body: marker },
      { number: 2, title, body: 'User discussion' },
      { number: 3, title, body: marker, pull_request: {} },
      { number: 4, title, body: marker, user: { login: 'github-actions[bot]', type: 'Bot' } },
      { number: 5, title, body: marker, user: { login: 'github-actions[bot]', type: 'Bot' } },
    ]);
    expect(await manageIncident({ result: healthy, github, owner, repo })).toEqual({ action: 'recovered', count: 2 });
    expect(github.paginate).toHaveBeenCalledWith(github.rest.issues.listForRepo, { owner, repo, state: 'open', per_page: 100 });
    expect(github.rest.issues.update.mock.calls.map(([parameters]) => parameters.issue_number)).toEqual([4, 5]);
  });

  it('keeps raw check contents out of issue bodies and comments', async () => {
    const github = offlineGitHub();
    const sensitive = 'private-monitor-body-marker';
    const result = { ...failed, checks: { api: { healthy: false, rawBody: sensitive } } };
    await manageIncident({ result, github, owner, repo, runUrl: 'https://github.com/eugnel-ltd/RealTimeTranslation/actions/runs/123' });
    const body = github.rest.issues.create.mock.calls[0]?.[0].body;
    expect(body).toContain(marker);
    expect(body).toContain('/actions/runs/123');
    expect(body).not.toContain(sensitive);
    await manageIncident({ result: healthy, github, owner, repo });
    expect(JSON.stringify(github.rest.issues.createComment.mock.calls)).not.toContain(sensitive);
  });
});
