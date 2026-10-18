import { afterEach, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { mockEnv } from './helpers';

const origin = 'https://rtt-wire.test.invalid';
const scope = { productId: 'rtt', environment: 'preview', origin };
const sessionValue = 'A'.repeat(43);
const signingMaterial = 'synthetic-account-wire-signing-material-over32';
const ids = ['legacy.account:42', 'legacy,42', '用戶-42', 'legacy%2C42', 'legacy account 42', 'legacy?/#42', '中'.repeat(128)];
type Envelope = { expectedAccount?: string; path?: string; token?: string };

function fixture(accountId: string) {
  const calls: Envelope[] = [];
  const productQueries: string[] = [];
  const providers: string[] = [];
  const env = mockEnv({ ACCOUNTS_ENABLED: '1', ACCOUNT_ENVIRONMENT: 'preview', ACCOUNT_ORIGIN: origin,
    ACCOUNT_DB: { prepare(sql: string) { productQueries.push(sql); return { bind() { return this; }, async all() { return { success: true, results: [{ fenced: 0 }] }; } }; }, batch() {} } as unknown as D1Database,
    IDENTITY_CALLER_ID: 'rtt-wire', IDENTITY_CALLER_SECRET: signingMaterial,
    IDENTITY_SERVICE: { async fetch(request: Request) {
      calls.push(await request.json() as Envelope);
      return new URL(request.url).pathname === '/v1/browser' ? Response.json({ ok: true }) : Response.json({ scope,
        session: { accountId, authenticatedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() } });
    } } as unknown as Fetcher,
    AZURE_SPEECH_KEY: signingMaterial, GEMINI_API_KEY: signingMaterial,
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => { providers.push(String(input)); return new Response('synthetic-token-response'); });
  vi.stubGlobal('WebSocketPair', class { 0 = { accept() {}, close() {} }; 1 = { accept() {}, close() {} }; });
  return { env, calls, productQueries, providers };
}
function request(expectation: string, ws = false) {
  const query = ws ? `?${new URLSearchParams({ expectedAccount: expectation })}` : '';
  return new Request(`${origin}${ws ? '/api/gemini-live' : '/api/speech-token'}${query}`, {
    headers: { Cookie: `__Host-eugnel_session=${sessionValue}`, ...(ws ? { Upgrade: 'websocket' } : { 'Eugnel-Expected-Account': expectation }) },
  });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(ids)('accepts an encoded HTTP expectation for the same verified canonical ID: %s', async accountId => {
  const { env, calls, productQueries, providers } = fixture(accountId);
  expect((await worker.fetch(request(`account:${encodeURIComponent(accountId)}`), env)).status).toBe(200);
  expect(calls).toEqual([{ token: sessionValue }]);
  expect(productQueries).toHaveLength(1);
  expect(providers).toHaveLength(1);
});

it.each(ids)('accepts the same canonical ID over a native WebSocket query: %s', async accountId => {
  const { env, providers } = fixture(accountId);
  expect((await worker.fetch(request(`account:${encodeURIComponent(accountId)}`, true), env)).status).toBe(502);
  expect(providers).toHaveLength(1); // Existing upstream handler reached; injected provider has no socket.
});

it('normalizes percent escape case before comparing the verified account', async () => {
  const { env } = fixture('legacy:42');
  expect((await worker.fetch(request('account:legacy%3a42'), env)).status).toBe(200);
});

it('forwards normalized encoded comparison metadata in the signed control envelope', async () => {
  const { env, calls } = fixture('legacy:42');
  const response = await worker.fetch(new Request(`${origin}/api/auth/google/start?${new URLSearchParams({ expectedAccount: 'account:legacy%3a42' })}`, {
    headers: { Cookie: `__Host-eugnel_session=${sessionValue}` },
  }), env);
  expect(response.status).toBe(200);
  expect(calls[0].expectedAccount).toBe('account:legacy%3A42');
  expect(calls[0].path).toBe('/api/auth/google/start');
});

it.each(['account:legacy%', 'account:legacy%GG', 'account:legacy%C0%AF', 'account:legacy%00', 'account:legacy%0A', 'account:%20legacy%20'])('refuses malformed encoding or decoded invalid canonical IDs: %s', async expectation => {
  const { env, providers, productQueries } = fixture('alice');
  expect((await worker.fetch(request(expectation), env)).status).toBe(400);
  expect(providers).toEqual([]);
  expect(productQueries).toEqual([]);
});

it('does not double decode a literal percent escape into another verified account', async () => {
  const { env, providers, productQueries } = fixture('legacy,42');
  const response = await worker.fetch(request(`account:${encodeURIComponent('legacy%2C42')}`), env);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'ACCOUNT_CHANGED' });
  expect(providers).toEqual([]);
  expect(productQueries).toEqual([]);
});

it('continues to reject raw comma ambiguity rather than treating it as encoded identity', async () => {
  const { env, providers, productQueries } = fixture('legacy,42');
  expect((await worker.fetch(request('account:legacy,42'), env)).status).toBe(400);
  expect(providers).toEqual([]);
  expect(productQueries).toEqual([]);
});
