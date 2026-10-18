import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountBrowser } from '../client/src/services/accountBrowser';
import { deferred } from './account-harness';

const origin = 'https://rtt.example.test';
const account = (accountId: string) => ({
  enabled: true, scope: { productId: 'rtt', environment: 'preview', origin },
  session: { accountId, authenticatedAt: '2026-10-18T01:00:00Z', expiresAt: '2099-10-18T12:00:00Z' },
  ways: [{ provider: 'email', email: `${accountId === 'account_A' ? 'a' : 'b'}•••@example.test` }],
  capabilities: { email: true, google: true, apple: true, siteKey: 'public-site' },
});
let browser: AccountBrowser;
let principal: string;
let pending: ReturnType<typeof deferred<Response>>;
beforeEach(async () => {
  principal = 'account_A'; pending = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn((path: string) => path === '/api/account' ? Promise.resolve(Response.json(account(principal))) : pending.promise));
  browser = new AccountBrowser(origin); await browser.refresh();
});
afterEach(() => { browser.dispose(); vi.unstubAllGlobals(); });

it.each(['reauth error', 'pending receipt'])('holds personal activity during account A delete %s and then verifies current B cookies', async (result) => {
  const deleting = browser.deleteAccount();
  principal = 'account_B'; await browser.refresh(true);
  expect(browser.current.status, 'no personal runtime may mount while the earlier control response is unsettled').toBe('loading');
  pending.resolve(result === 'reauth error'
    ? Response.json({ error: 'REAUTH_REQUIRED' }, { status: 403 })
    : Response.json({ jobId: 'job_A', state: 'pending', phase: 'products' }, { status: 202 }));
  await deleting;
  if (browser.current.status !== 'account') throw new Error('expected verified B');
  expect(browser.current.account.session?.accountId).toBe('account_B');
  expect(browser.current.account.ways[0].email).toBe('b•••@example.test');
});

it.each(['email verification', 'signout'])('ignores a stale %s error after a verified account B switch', async (operation) => {
  const changing = operation === 'email verification' ? browser.verifyEmail('a@example.test', '111111').catch(() => undefined) : browser.signout();
  principal = 'account_B'; await browser.refresh(true);
  expect(browser.current.status, 'cross-tab verification cannot resume personal activity before own control settles').toBe('loading');
  pending.resolve(Response.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 })); await changing;
  if (browser.current.status !== 'account') throw new Error('expected verified B');
  expect(browser.current.account.session?.accountId).toBe('account_B');
});

it('a stale Google cancellation cannot revoke a newer verified account lifetime', async () => {
  const cancelling = browser.cancelGoogle(); principal = 'account_B'; await browser.refresh(true);
  expect(browser.current.status).toBe('loading');
  pending.resolve(Response.json({ ok: true })); await cancelling;
  if (browser.current.status !== 'account') throw new Error('expected verified B');
  expect(browser.current.account.session?.accountId).toBe('account_B');
});

it('holds activity through late Set-Cookie headers and delayed JSON, then verifies the actual settled cookie principal', async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }));
  const fetcher = vi.mocked(fetch);
  fetcher.mockImplementation((input) => {
    if (String(input) === '/api/account') return Promise.resolve(Response.json(account(principal)));
    return pending.promise.then((result) => { principal = 'account_C'; return result; });
  });
  const verifying = browser.verifyEmail('a@example.test', '111111').catch(() => undefined);
  principal = 'account_B'; await browser.refresh(true);
  expect(browser.current.status).toBe('loading');
  pending.resolve(response); await Promise.resolve(); await browser.refresh(true);
  expect(browser.current.status, 'headers have changed the cookie but the own response body is still pending').toBe('loading');
  body.enqueue(new TextEncoder().encode(JSON.stringify({ ok: true }))); body.close(); await verifying;
  if (browser.current.status !== 'account') throw new Error('expected newly verified settled principal');
  expect(browser.current.account.session?.accountId).toBe('account_C');
});

it('preserves same-account email-code continuation only in memory across the control quarantine', async () => {
  const starting = browser.startEmail('a@example.test', 'fixture');
  expect(browser.current.status, 'email start also quarantines personal activity while the response is unsettled').toBe('loading');
  pending.resolve(Response.json({ ok: true })); await starting;
  expect(Reflect.get(browser, 'emailForCode'), 'the remounted form must continue the requested same-account challenge').toBe('a@example.test');
  expect(browser.current.status).toBe('account');
  principal = 'account_B'; await browser.refresh(true);
  expect(Reflect.get(browser, 'emailForCode'), 'switching principals clears the unpersisted address').toBeUndefined();
});

it('routine verification cannot reopen a same-account session during a pending or failed signout', async () => {
  const signingOut = browser.signout(); await browser.refresh();
  expect(browser.current.status, 'poll/focus must not reopen the session being signed out').toBe('loading');
  pending.resolve(Response.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 })); await signingOut;
  expect(browser.current.status).toBe('unavailable');
  await browser.refresh();
  expect(browser.current, 'failed signout remains closed until explicit retry').toEqual(expect.objectContaining({ status: 'unavailable', retry: 'signout' }));
});
