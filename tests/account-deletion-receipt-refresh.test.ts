import { afterEach, expect, it, vi } from 'vitest';
import { AccountBrowser } from '../client/src/services/accountBrowser';
import { createStorageScope } from '../client/src/services/browserStorage';

afterEach(() => vi.unstubAllGlobals());
it('keeps an already confirmed same-page cache result truthful across receipt refreshes', async () => {
  const origin = 'https://rtt.example.test';
  const scope = { productId: 'rtt', environment: 'preview', origin } as const;
  let signedIn = true;
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  const storage = createStorageScope({ ...scope, accountId: 'account_A' });
  for (const key of ['user_settings', 'transcriptionHistory', 'rtt_azure_quota_fallback_month']) storage.setItem(key, 'A');
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path === '/api/account') return Response.json({ enabled: true, scope,
      session: signedIn ? { accountId: 'account_A', authenticatedAt: '2026-10-18T01:00:00Z', expiresAt: '2099-10-18T12:00:00Z' } : null,
      ways: [], capabilities: { email: false, google: false, apple: false, siteKey: null },
    });
    if (path === '/api/account/delete') {
      signedIn = false;
      return Response.json({ jobId: 'job_A', state: 'pending', phase: 'products' }, { status: 202 });
    }
    if (path === '/api/account/delete/status') return Response.json({ jobId: 'job_A', state: 'completed', phase: 'completed', completedAt: '2026-10-18T10:00:00Z' });
    throw new Error('Unexpected synthetic route');
  }));
  const browser = new AccountBrowser(origin);
  try {
    await browser.refresh(); await browser.deleteAccount();
    if (browser.current.status !== 'deletion') throw new Error('Expected initial completion');
    const confirmedMessage = browser.current.cacheMessage;
    expect(confirmedMessage).toContain('were removed'); expect(stored.size).toBe(0);
    await browser.refresh();
    if (browser.current.status !== 'deletion') throw new Error('Expected refreshed completion');
    expect(browser.current.cacheMessage, 'same-page refresh must retain the confirmed cache result rather than claim a reload').toBe(confirmedMessage);
    expect(stored.size).toBe(0);
  } finally { browser.dispose(); }
});
