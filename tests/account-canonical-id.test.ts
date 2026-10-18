import { afterEach, expect, it, vi } from 'vitest';
import { parseAccount } from '../client/src/services/accounts';
import { createStorageScope } from '../client/src/services/browserStorage';
import { createAppRuntime } from '../client/src/services/accountLifetime';
import { fetchSpeechToken } from '../client/src/services/api';

const origin = 'https://rtt.example.test';
const account = (accountId: string) => ({
  enabled: true, scope: { productId: 'rtt', environment: 'preview', origin },
  session: { accountId, authenticatedAt: '2026-10-18T01:00:00Z', expiresAt: '2099-10-18T12:00:00Z' },
  ways: [], capabilities: { email: false, google: true, apple: false, siteKey: null },
});
afterEach(() => vi.unstubAllGlobals());

const canonicalIds = ['legacy.account:42', 'legacy,account42', '既存アカウント42', 'literal%2Caccount'];
it.each(canonicalIds)('preserves valid canonical legacy account %s through verified bootstrap', (accountId) => {
  const parsed = parseAccount(account(accountId), origin);
  if (!parsed.enabled) throw new Error('expected enabled account');
  expect(parsed.session?.accountId).toBe(accountId);
});

it.each(canonicalIds)('captures exact canonical %s in collision-free storage and an encoded consistency header', async (accountId) => {
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  const storage = createStorageScope({ ...account('').scope, accountId });
  const other = createStorageScope({ ...account('').scope, accountId: 'legacy.account' });
  storage.setItem('user_settings', 'legacy account'); expect(other.getItem('user_settings')).toBeNull();
  const fetcher = vi.fn(async () => Response.json({})); vi.stubGlobal('fetch', fetcher);
  const lifetime = createAppRuntime(storage, true, () => undefined);
  await fetchSpeechToken(lifetime);
  expect(fetcher).toHaveBeenCalledWith('/api/speech-token', expect.objectContaining({ headers: expect.any(Headers) }));
  const init = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0][1];
  expect(new Headers(init.headers).get('Eugnel-Expected-Account')).toBe(`account:${encodeURIComponent(accountId)}`);
  lifetime.revoke();
});

it('rejects invalid account IDs without broadening environment/configuration IDs', () => {
  for (const id of ['', ' leading', 'trailing ', 'bad\nline', 'x'.repeat(129)]) {
    expect(() => parseAccount(account(id), origin)).toThrow();
    expect(() => createStorageScope({ ...account('').scope, accountId: id })).toThrow();
  }
  expect(() => parseAccount({ ...account('legacy.account:42'), scope: { ...account('').scope, environment: 'preview:production' } }, origin)).toThrow();
  expect(() => createStorageScope({ ...account('').scope, environment: 'preview:production', accountId: 'legacy.account:42' })).toThrow();
});
