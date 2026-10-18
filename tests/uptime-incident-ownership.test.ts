import { describe, expect, it, vi } from 'vitest';
import type { UptimeResult } from '../scripts/uptime.mjs';

const manageIncident: typeof import('../scripts/uptime-incident.mjs').manageIncident = async (...args) =>
  (await import('../scripts/uptime-incident.mjs')).manageIncident(...args);

type Author = { login?: string; type?: string } | null;
type Issue = { number: number; title: string; body: string; user?: Author };
const title = 'Uptime: rtt.eugnel.com is failing';
const marker = '<!-- rtt-uptime-incident -->';
const owner = 'eugnel-ltd';
const repo = 'RealTimeTranslation';
const bot = { login: 'github-actions[bot]', type: 'Bot' };
const failed: UptimeResult = { configured: true, healthy: false, exitCode: 1, checks: {} };
const healthy: UptimeResult = { configured: true, healthy: true, exitCode: 0, checks: {} };
const untrustedAuthors: Array<[string, Author | undefined]> = [
  ['human copying the title and marker', { login: 'customer-user', type: 'User' }],
  ['missing user', undefined],
  ['null user', null],
  ['missing login', { type: 'Bot' }],
  ['missing type', { login: 'github-actions[bot]' }],
  ['different bot', { login: 'dependabot[bot]', type: 'Bot' }],
  ['expected login with human type', { login: 'github-actions[bot]', type: 'User' }],
];

function issue(number: number, user?: Author): Issue { return { number, title, body: marker, user }; }
function offlineGitHub(initial: Issue[]) {
  const open = [...initial];
  const issues = {
    listForRepo: vi.fn(),
    create: vi.fn(async (parameters: { owner: string; repo: string; title: string; body: string }) => {
      open.push({ number: 1001, ...parameters, user: bot });
      return {};
    }),
    createComment: vi.fn(async (_parameters: { owner: string; repo: string; issue_number: number; body: string }) => ({})),
    update: vi.fn(async (parameters: { owner: string; repo: string; issue_number: number; state: 'closed'; state_reason: 'completed' }) => {
      const index = open.findIndex((candidate) => candidate.number === parameters.issue_number);
      if (index >= 0) open.splice(index, 1);
      return {};
    }),
  };
  return { open, github: { paginate: vi.fn(async () => [...open]), rest: { issues } } };
}

describe('uptime incident automation ownership', () => {
  it.each(untrustedAuthors)('a %s cannot suppress an automation incident during an outage', async (_name, user) => {
    const { github, open } = offlineGitHub([issue(1, user)]);
    expect(await manageIncident({ result: failed, github, owner, repo })).toEqual({ action: 'opened', count: 1 });
    expect(github.rest.issues.create).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
    expect(github.rest.issues.update).not.toHaveBeenCalled();
    expect(open.map((candidate) => candidate.number)).toEqual([1, 1001]);
  });

  it.each(untrustedAuthors)('a %s receives no automatic recovery comment or closure', async (_name, user) => {
    const { github, open } = offlineGitHub([issue(1, user)]);
    expect(await manageIncident({ result: healthy, github, owner, repo })).toEqual({ action: 'healthy', count: 0 });
    expect(github.rest.issues.create).not.toHaveBeenCalled();
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
    expect(github.rest.issues.update).not.toHaveBeenCalled();
    expect(open.map((candidate) => candidate.number)).toEqual([1]);
  });

  it('deduplicates only the expected automation issue in a mixed issue list', async () => {
    const { github } = offlineGitHub([issue(1, { login: 'customer-user', type: 'User' }), issue(2), issue(3, bot)]);
    expect(await manageIncident({ result: failed, github, owner, repo })).toEqual({ action: 'existing', count: 1 });
    expect(github.rest.issues.create).not.toHaveBeenCalled();
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
    expect(github.rest.issues.update).not.toHaveBeenCalled();
  });

  it('recovers only the expected automation issue while leaving human and unknown owners untouched', async () => {
    const { github, open } = offlineGitHub([issue(1, { login: 'customer-user', type: 'User' }), issue(2), issue(3, bot)]);
    expect(await manageIncident({ result: healthy, github, owner, repo })).toEqual({ action: 'recovered', count: 1 });
    expect(github.rest.issues.createComment.mock.calls.map(([parameters]) => parameters.issue_number)).toEqual([3]);
    expect(github.rest.issues.update.mock.calls.map(([parameters]) => parameters.issue_number)).toEqual([3]);
    expect(open.map((candidate) => candidate.number)).toEqual([1, 2]);
  });

  it('still opens, deduplicates and recovers a correctly authored automation incident', async () => {
    const { github } = offlineGitHub([]);
    expect(await manageIncident({ result: failed, github, owner, repo })).toEqual({ action: 'opened', count: 1 });
    expect(await manageIncident({ result: failed, github, owner, repo })).toEqual({ action: 'existing', count: 1 });
    expect(await manageIncident({ result: healthy, github, owner, repo })).toEqual({ action: 'recovered', count: 1 });
    expect(github.rest.issues.create).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.update).toHaveBeenCalledTimes(1);
  });
});
