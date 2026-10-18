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

it.each(['reauth error', 'pending receipt'])('ignores a stale account A delete %s after a verified account B switch', async (result) => {
  const deleting = browser.deleteAccount();
  principal = 'account_B'; await browser.refresh(true);
  const b = browser.current;
  pending.resolve(result === 'reauth error'
    ? Response.json({ error: 'REAUTH_REQUIRED' }, { status: 403 })
    : Response.json({ jobId: 'job_A', state: 'pending', phase: 'products' }, { status: 202 }));
  await deleting;
  expect(browser.current, 'a delayed A delete result must not replace B or reveal A methods').toBe(b);
  if (browser.current.status !== 'account') throw new Error('expected verified B');
  expect(browser.current.account.session?.accountId).toBe('account_B');
});

it.each(['email verification', 'signout'])('ignores a stale %s error after a verified account B switch', async (operation) => {
  const changing = operation === 'email verification' ? browser.verifyEmail('a@example.test', '111111').catch(() => undefined) : browser.signout();
  principal = 'account_B'; await browser.refresh(true); const b = browser.current;
  pending.resolve(Response.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 })); await changing;
  expect(browser.current, 'a delayed old control error must not overwrite the new verified account').toBe(b);
});

it('a stale Google cancellation cannot revoke a newer verified account lifetime', async () => {
  const cancelling = browser.cancelGoogle(); principal = 'account_B'; await browser.refresh(true);
  const b = browser.current; pending.resolve(Response.json({ ok: true })); await cancelling;
  expect(browser.current).toBe(b);
  if (b.status !== 'account') throw new Error('expected verified B');
  expect(b.runtime.active).toBe(true);
});

it('routine verification cannot reopen a same-account session during a pending or failed signout', async () => {
  const signingOut = browser.signout(); await browser.refresh();
  expect(browser.current.status, 'poll/focus must not reopen the session being signed out').toBe('loading');
  pending.resolve(Response.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 })); await signingOut;
  expect(browser.current.status).toBe('unavailable');
  await browser.refresh();
  expect(browser.current, 'failed signout remains closed until explicit retry').toEqual(expect.objectContaining({ status: 'unavailable', retry: 'signout' }));
});
