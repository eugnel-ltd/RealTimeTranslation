import { afterEach, expect, it, vi } from 'vitest';
import { AccountBrowser } from '../client/src/services/accountBrowser';
import { deferred } from './account-harness';

afterEach(() => vi.unstubAllGlobals());
it('preserves an email challenge across same-principal focus during the response hold', async () => {
  const pending = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn((path: string) => path === '/api/account' ? Promise.resolve(Response.json({
    enabled: true, scope: { productId: 'rtt', environment: 'preview', origin: 'https://rtt.example.test' },
    session: { accountId: 'account_A', authenticatedAt: '2026-10-18T01:00:00Z', expiresAt: '2099-10-18T12:00:00Z' },
    ways: [], capabilities: { email: true, google: false, apple: false, siteKey: 'public-site' },
  })) : pending.promise));
  const browser = new AccountBrowser('https://rtt.example.test'); await browser.refresh();
  try {
    const sending = browser.startEmail('a@example.test', 'fixture');
    await browser.refresh(); expect(browser.current.status).toBe('loading');
    pending.resolve(Response.json({ ok: true })); await sending;
    expect(browser.current.status).toBe('account');
    expect(browser.emailForCode, 'benign same-account focus must not lose the just-requested code form/address').toBe('a@example.test');
  } finally { browser.dispose(); }
});
