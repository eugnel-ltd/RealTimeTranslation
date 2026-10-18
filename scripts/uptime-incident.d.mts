import type { UptimeResult } from './uptime.mjs';

interface Issue {
  number: number;
  title: string;
  body?: string | null;
  pull_request?: unknown;
  user?: { login?: string; type?: string } | null;
}

interface IssueApi {
  listForRepo: unknown;
  create: (parameters: { owner: string; repo: string; title: string; body: string }) => Promise<unknown>;
  createComment: (parameters: { owner: string; repo: string; issue_number: number; body: string }) => Promise<unknown>;
  update: (parameters: { owner: string; repo: string; issue_number: number; state: 'closed'; state_reason: 'completed' }) => Promise<unknown>;
}

export function manageIncident(options: {
  result: UptimeResult;
  github: {
    paginate: (method: unknown, parameters: { owner: string; repo: string; state: 'open'; per_page: number }) => Promise<Issue[]>;
    rest: { issues: IssueApi };
  };
  owner: string;
  repo: string;
  runUrl?: string;
}): Promise<{ action: 'unconfigured' | 'opened' | 'existing' | 'recovered' | 'healthy'; count: number }>;
