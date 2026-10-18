import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import ReactRuntime from '../client/node_modules/react';
import type { ReactNode } from 'react';
import { deferred, findProps, flush, hookHarness } from './account-harness';

const root = vi.hoisted(() => ({ node: undefined as ReactNode }));
const React = ReactRuntime as typeof import('react');
vi.mock('../client/node_modules/react-dom/client', () => ({
  default: { createRoot: () => ({ render: (node: ReactNode) => { root.node = node; } }) },
}));
vi.mock('react-dom/client', () => ({
  default: { createRoot: () => ({ render: (node: ReactNode) => { root.node = node; } }) },
}));
vi.mock('../client/src/services/speechController', () => ({ SpeechController: class { async stop() {} } }));
let reads: string[];
let response = deferred<Response>();
let run: ReturnType<typeof hookHarness<Record<string, unknown>>>;
const account = (accountId = 'account_A') => ({
  enabled: true, scope: { productId: 'rtt', environment: 'development', origin: 'https://rtt.example.test' },
  session: { accountId, authenticatedAt: '2026-10-18T10:00:00.000Z', expiresAt: '2099-10-18T12:00:00.000Z' },
  ways: [{ provider: 'email', email: 'a***@example.test' }],
  capabilities: { email: true, google: false, apple: false, siteKey: 'public-test-site' },
});

beforeAll(async () => {
  vi.stubGlobal('document', { getElementById: () => ({}) });
  await import('../client/src/main');
});
beforeEach(() => {
  vi.useFakeTimers();
  reads = []; response = deferred<Response>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => { reads.push(key); return null; }, setItem() {}, removeItem() {} });
  vi.stubGlobal('location', { origin: 'https://rtt.example.test', href: 'https://rtt.example.test/', search: '' });
  vi.stubGlobal('window', { location, addEventListener() {}, removeEventListener() {}, history: { replaceState() {} } });
  vi.stubGlobal('fetch', vi.fn(() => response.promise));
  const strict = root.node;
  if (!React.isValidElement<{ children: ReactNode }>(strict)) throw new Error('main must render a React root');
  const child = React.Children.only(strict.props.children);
  if (!React.isValidElement<Record<string, unknown>>(child) || typeof child.type !== 'function') throw new Error('main must render a bootstrap component');
  run = hookHarness(child.type as (props: Record<string, unknown>) => ReactNode, child.props);
});
afterEach(() => { run.unmount(); vi.clearAllTimers(); vi.useRealTimers(); });
afterAll(() => vi.unstubAllGlobals());

it('production entry mounts no personal consumer before server mode/account verification', () => {
  run.render();
  expect(reads, 'startup must not read owner settings while account mode is unknown').toEqual([]);
  expect(findProps(run.tree, 'App')).toBeUndefined();
  expect(fetch).toHaveBeenCalledWith('/api/account', expect.objectContaining({ credentials: 'include' }));
  run.unmount();
});

it.each([
  ['unavailable', null],
  ['unknown mode', {}],
  ['wrong origin', { ...account(), scope: { ...account().scope, origin: 'https://other.example.test' } }],
  ['expired session', { ...account(), session: { ...account().session, expiresAt: '2000-01-01T00:00:00Z' } }],
])('never falls back to unassigned data for %s', async (_name, body) => {
  run.render();
  response.resolve(new Response(JSON.stringify(body), { status: body === null ? 503 : 200 }));
  await flush(); run.render();
  expect(reads, 'failed or invalid enabled configuration must stay closed').toEqual([]);
  expect(findProps(run.tree, 'App')).toBeUndefined();
  run.unmount();
});

it('mounts a verified account with a captured runtime', async () => {
  run.render(); response.resolve(Response.json(account())); await flush(); run.render();
  const props = findProps<{ runtime?: { storage: unknown; active: boolean } }>(run.tree, 'App');
  expect(props?.runtime?.storage, 'enabled account must pass explicit scoped storage to App').toBeDefined();
  expect(props?.runtime?.active).toBe(true);
  expect(reads).toEqual([]);
  run.unmount();
});

it('only an explicit disabled response permits an owner-mode application scope', async () => {
  run.render(); response.resolve(Response.json({ enabled: false })); await flush(); run.render();
  const props = findProps<{ runtime?: { storage: { key(key: string): string } } }>(run.tree, 'App');
  expect(props?.runtime?.storage.key('user_settings')).toBe('user_settings');
  expect(reads).toEqual([]);
});
