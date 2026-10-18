import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountBrowser } from '../client/src/services/accountBrowser';
import { parseAccount } from '../client/src/services/accounts';
import { deferred, flush } from './account-harness';

const origin = 'https://rtt.example.test';
function account(accountId = 'account_A', expiresAt = '2026-10-19T12:00:00Z') {
  return {
    enabled: true, scope: { productId: 'rtt', environment: 'preview', origin },
    session: { accountId, authenticatedAt: '2026-10-18T12:00:00Z', expiresAt },
    ways: [{ provider: 'email', email: 'a•••@example.test' }],
    capabilities: { email: true, google: true, apple: true, siteKey: 'public-site' },
  };
}
let browser: AccountBrowser;
let current: unknown;
let deletion: { jobId: string; state: string; phase: string; completedAt: string | null } | null;
let stored: Map<string, string>;
let writes: string[];
let fetcher: ReturnType<typeof vi.fn<(path: string, init?: RequestInit) => Promise<Response>>>;
let announced: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T12:01:00Z'));
  current = account(); deletion = null; stored = new Map([['user_settings', 'unassigned owner']]); writes = [];
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(key); stored.set(key, value); },
    removeItem: (key: string) => stored.delete(key),
  });
  vi.stubGlobal('window', { location: { assign: vi.fn() } });
  fetcher = vi.fn(async (path: string) => {
    if (path === '/api/account') return Response.json(current);
    if (path === '/api/account/delete/status') return deletion ? Response.json(deletion) : Response.json({ error: 'DELETE_TICKET_INVALID' }, { status: 401 });
    throw new Error(`Unexpected route ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  announced = vi.fn(); browser = new AccountBrowser(origin, announced);
});
afterEach(() => { browser.dispose(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps a signed-out enabled user closed and preserves all unassigned storage', async () => {
  current = { ...account(), session: null, ways: [] };
  await browser.refresh();
  expect(browser.current.status).toBe('signed-out');
  expect(writes).toEqual([]); expect(stored.get('user_settings')).toBe('unassigned owner');
});

it('keeps an identical verified account lifetime during routine revalidation', async () => {
  await browser.refresh(); const before = browser.current;
  await browser.refresh();
  expect(browser.current.status).toBe('account');
  if (before.status !== 'account' || browser.current.status !== 'account') throw new Error('expected account');
  expect(browser.current.runtime).toBe(before.runtime); expect(before.runtime.active).toBe(true);
});

it('synchronously revokes on a cross-tab hint and only mounts the new server-verified account', async () => {
  await browser.refresh(); const before = browser.current;
  if (before.status !== 'account') throw new Error('expected account');
  const pending = deferred<Response>(); fetcher.mockReturnValueOnce(pending.promise);
  const refresh = browser.refresh(true);
  expect(before.runtime.active).toBe(false); expect(browser.current.status).toBe('loading');
  pending.resolve(Response.json(account('account_B'))); await refresh;
  expect(browser.current.status).toBe('account');
  if (browser.current.status !== 'account') throw new Error('expected account');
  expect(browser.current.account.session?.accountId).toBe('account_B');
  expect(browser.current.runtime.storage.key('user_settings')).not.toBe(before.runtime.storage.key('user_settings'));
});

it('discards an older bootstrap reply after a newer verified account reply', async () => {
  const slow = deferred<Response>(); fetcher.mockReturnValueOnce(slow.promise);
  const older = browser.refresh();
  current = account('account_B'); await browser.refresh();
  slow.resolve(Response.json(account('account_A'))); await older;
  expect(browser.current.status).toBe('account');
  if (browser.current.status !== 'account') throw new Error('expected account');
  expect(browser.current.account.session?.accountId).toBe('account_B');
});

it('revokes exactly at expiry and verifies signed-out state without owner fallback', async () => {
  current = account('account_A', '2026-10-18T12:01:01Z'); await browser.refresh();
  const before = browser.current;
  if (before.status !== 'account') throw new Error('expected account');
  current = { ...account(), session: null, ways: [] };
  await vi.advanceTimersByTimeAsync(1000); await flush();
  expect(before.runtime.active).toBe(false); expect(browser.current.status).toBe('signed-out');
});

it('signs out using a live independent control request after revoking application work', async () => {
  await browser.refresh(); const before = browser.current;
  if (before.status !== 'account') throw new Error('expected account');
  const pending = deferred<Response>();
  fetcher.mockImplementationOnce(async (path, init) => {
    expect(path).toBe('/api/auth/signout'); expect(before.runtime.active).toBe(false);
    expect(init?.signal?.aborted).toBe(false); expect(init?.body).toBe('{}'); return pending.promise;
  });
  const signingOut = browser.signout(); expect(browser.current.status).toBe('loading');
  current = { ...account(), session: null, ways: [] }; pending.resolve(Response.json({ ok: true })); await signingOut;
  expect(browser.current.status).toBe('signed-out'); expect(announced).toHaveBeenCalled();
});

it('holds a failed signout closed and offers the same mutation retry', async () => {
  await browser.refresh(); const before = browser.current;
  fetcher.mockResolvedValueOnce(Response.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 }));
  await browser.signout();
  expect(browser.current).toEqual(expect.objectContaining({ status: 'unavailable', retry: 'signout' }));
  if (before.status !== 'account') throw new Error('expected account');
  expect(before.runtime.active).toBe(false);
});

it('does not erase cache while deletion is pending or failed, then erases only the confirmed initiating account', async () => {
  await browser.refresh(); const before = browser.current;
  if (before.status !== 'account') throw new Error('expected account');
  before.runtime.storage.setItem('user_settings', 'A');
  before.runtime.storage.setItem('transcriptionHistory', 'A history');
  stored.set('other-account', 'B');
  fetcher.mockImplementationOnce(async () => {
    current = { ...account(), session: null, ways: [] };
    deletion = { jobId: 'job_A', state: 'pending', phase: 'products', completedAt: null };
    return Response.json(deletion, { status: 202 });
  });
  await browser.deleteAccount(); expect(before.runtime.active).toBe(false);
  expect(fetcher).toHaveBeenCalledWith('/api/account/delete', expect.objectContaining({ body: JSON.stringify({ confirm: true }), credentials: 'include' }));
  expect(stored.get(before.runtime.storage.key('user_settings'))).toBe('A');
  fetcher.mockResolvedValueOnce(Response.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 }));
  await browser.deletionStep(true); expect(stored.get(before.runtime.storage.key('user_settings'))).toBe('A');
  fetcher.mockImplementationOnce(async () => {
    deletion = { jobId: 'job_A', state: 'completed', phase: 'complete', completedAt: '2026-10-18T12:02:00Z' };
    return Response.json(deletion);
  });
  await browser.deletionStep(true);
  expect(stored.has(before.runtime.storage.key('user_settings'))).toBe(false);
  expect(stored.get('user_settings')).toBe('unassigned owner'); expect(stored.get('other-account')).toBe('B');
});

it('does not erase a remembered namespace for a different deletion receipt', async () => {
  await browser.refresh(); const before = browser.current;
  if (before.status !== 'account') throw new Error('expected account');
  before.runtime.storage.setItem('user_settings', 'A');
  fetcher.mockImplementationOnce(async () => {
    current = { ...account(), session: null, ways: [] };
    deletion = { jobId: 'job_A', state: 'pending', phase: 'products', completedAt: null };
    return Response.json(deletion, { status: 202 });
  });
  await browser.deleteAccount();
  fetcher.mockImplementationOnce(async () => {
    deletion = { jobId: 'job_B', state: 'completed', phase: 'complete', completedAt: '2026-10-18T12:02:00Z' };
    return Response.json(deletion);
  });
  await browser.deletionStep(false);
  expect(stored.get(before.runtime.storage.key('user_settings'))).toBe('A');
});

it('requires fresh reauthentication without deleting caches on REAUTH_REQUIRED', async () => {
  await browser.refresh(); const before = browser.current;
  fetcher.mockResolvedValueOnce(Response.json({ error: 'REAUTH_REQUIRED' }, { status: 403 }));
  await browser.deleteAccount();
  expect(browser.current).toEqual(expect.objectContaining({ status: 'signed-out', reauth: true }));
  if (before.status !== 'account') throw new Error('expected account');
  expect(before.runtime.active).toBe(false); expect(stored.get('user_settings')).toBe('unassigned owner');
});

it('uses only fixed OAuth navigation routes after synchronously revoking the current account', async () => {
  await browser.refresh(); const before = browser.current;
  browser.oauth('apple');
  if (before.status !== 'account') throw new Error('expected account');
  expect(before.runtime.active).toBe(false); expect(window.location.assign).toHaveBeenCalledWith('/api/auth/apple/start?expectedAccount=account%3Aaccount_A');
});

it('accepts actual provider masks and rejects raw emails, unknown config, wrong scope and malformed receipts', () => {
  expect(parseAccount(account(), origin).enabled).toBe(true);
  for (const value of [
    {}, { enabled: 'false' }, { ...account(), scope: { ...account().scope, origin: 'https://evil.example.test' } },
    { ...account(), ways: [{ provider: 'email', email: 'full@example.test' }] },
  ]) expect(() => parseAccount(value, origin)).toThrow();
});
