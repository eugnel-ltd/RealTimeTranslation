import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountBrowser } from '../client/src/services/accountBrowser';
import { createStorageScope } from '../client/src/services/browserStorage';
import { deferred } from './account-harness';

const origin = 'https://rtt.example.test';
const scope = { productId: 'rtt', environment: 'preview', origin } as const;
const names = ['user_settings', 'transcriptionHistory', 'rtt_azure_quota_fallback_month'];
const account = (accountId: string | null, environment = 'preview') => ({
  enabled: true, scope: { ...scope, environment },
  session: accountId ? { accountId, authenticatedAt: '2026-10-18T01:00:00Z', expiresAt: '2099-10-18T12:00:00Z' } : null,
  ways: [], capabilities: { email: false, google: false, apple: false, siteKey: null },
});
const receipt = (state: 'pending' | 'completed', jobId = 'job_A') => ({
  jobId, state, phase: state === 'pending' ? 'products' : 'completed',
  completedAt: state === 'completed' ? '2026-10-18T10:00:00Z' : null,
});
const storageA = () => createStorageScope({ ...scope, accountId: 'account_A' });
const storageB = () => createStorageScope({ ...scope, accountId: 'account_B' });
let stored: Map<string, string>;
let browser: AccountBrowser;
let bootstrap: unknown;
let progress: ReturnType<typeof receipt> | null;
let available: boolean;
let starting: ReturnType<typeof deferred<Response>>;

beforeEach(async () => {
  stored = new Map(); available = true; bootstrap = account('account_A'); progress = null; starting = deferred<Response>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  for (const name of names) {
    stored.set(name, 'owner'); storageA().setItem(name, 'A'); storageB().setItem(name, 'B');
  }
  storageA().setItem('unrelated', 'keep');
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path === '/api/account') return available ? Response.json(bootstrap) : Response.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 });
    if (path === '/api/account/delete') return starting.promise;
    if (path === '/api/account/delete/status') return progress ? Response.json(progress) : Response.json({ error: 'DELETE_TICKET_INVALID' }, { status: 401 });
    if (path === '/api/account/delete/advance') { progress = receipt('completed', progress?.jobId); return Response.json(progress); }
    if (path === '/api/auth/signout') { bootstrap = account(null); progress = null; return Response.json({ ok: true }); }
    throw new Error('Unexpected synthetic route');
  }));
  browser = new AccountBrowser(origin); await browser.refresh();
});
afterEach(() => { browser.dispose(); vi.unstubAllGlobals(); });

function retained() {
  expect(names.map(name => stored.get(storageA().key(name)))).toEqual(['A', 'A', 'A']);
  expect(names.map(name => stored.get(storageB().key(name)))).toEqual(['B', 'B', 'B']);
  expect(names.map(name => stored.get(name))).toEqual(['owner', 'owner', 'owner']);
}
function removedOnlyA() {
  expect(names.map(name => stored.has(storageA().key(name))), 'matching confirmed erasure must remove all three initiating-account cache keys').toEqual([false, false, false]);
  expect(names.map(name => stored.get(storageB().key(name)))).toEqual(['B', 'B', 'B']);
  expect(names.map(name => stored.get(name))).toEqual(['owner', 'owner', 'owner']);
  expect(stored.get(storageA().key('unrelated'))).toBe('keep');
  if (browser.current.status !== 'deletion') throw new Error('Expected deletion receipt');
  expect(browser.current.cacheMessage).not.toContain('after reload');
}
async function started(hint?: boolean) {
  const deleting = browser.deleteAccount();
  if (hint !== undefined) { await browser.refresh(hint); expect(browser.current.status).toBe('loading'); }
  bootstrap = account(null); progress = receipt('pending');
  starting.resolve(Response.json(progress, { status: 202 })); await deleting;
  expect(browser.current.status).toBe('deletion'); retained();
}

it.each([false, true])('retains the initiating cache/job through pending-delete verification hint invalidate=%s', async invalidate => {
  await started(invalidate); await browser.deletionStep(true); removedOnlyA();
});

it('preserves the existing matching completion behavior without a verification hint', async () => {
  await started(); await browser.deletionStep(true); removedOnlyA();
});

it('does not erase any cache while the matching job remains pending', async () => {
  await started(false); await browser.deletionStep(false); retained();
  expect(browser.current.status === 'deletion' && browser.current.receipt.state).toBe('pending');
});

it('retains the candidate across unavailable bootstrap without erasing before verified completion', async () => {
  const deleting = browser.deleteAccount(); await browser.refresh();
  bootstrap = account(null); progress = receipt('pending'); available = false;
  starting.resolve(Response.json(progress, { status: 202 })); await deleting;
  expect(browser.current.status).toBe('unavailable'); retained();
  available = true; progress = receipt('completed'); await browser.refresh(); removedOnlyA();
});

it('discards A continuation after settled bootstrap verifies B, including a later matching A receipt', async () => {
  const deleting = browser.deleteAccount(); bootstrap = account('account_B'); await browser.refresh(true);
  expect(browser.current.status).toBe('loading');
  starting.resolve(Response.json(receipt('pending'), { status: 202 })); await deleting;
  expect(browser.current.status === 'account' && browser.current.account.session?.accountId).toBe('account_B');
  bootstrap = account(null); progress = receipt('completed'); await browser.refresh(); retained();
});

it.each(['different scope', 'disabled owner mode'])('discards a captured cache when fresh verification establishes %s', async change => {
  await started(); bootstrap = change === 'different scope' ? account(null, 'production') : { enabled: false };
  progress = receipt('completed'); await browser.refresh(); retained();
  bootstrap = account(null); await browser.refresh(); retained();
});

it('cannot use a different completed job to clear initiating A or account B', async () => {
  await started(); progress = receipt('completed', 'job_B'); await browser.refresh(); retained();
});

it.each(['malformed receipt', 'failed request'])('never binds storage from an initiating %s', async outcome => {
  const deleting = browser.deleteAccount(); bootstrap = account(null); progress = receipt('completed');
  starting.resolve(outcome === 'malformed receipt'
    ? Response.json({ state: 'pending', phase: 'products' }, { status: 202 })
    : Response.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 }));
  await deleting; retained();
});

it('explicit signout discards the cache candidate even if the old job later completes', async () => {
  await started(); await browser.signout(); progress = receipt('completed'); await browser.refresh(); retained();
});

it('does not guess a cache namespace after a real manager reload', async () => {
  await started(); browser.dispose(); browser = new AccountBrowser(origin);
  progress = receipt('completed'); await browser.refresh(); retained();
  if (browser.current.status !== 'deletion') throw new Error('Expected completion receipt');
  expect(browser.current.cacheMessage).toContain('after reload');
});
