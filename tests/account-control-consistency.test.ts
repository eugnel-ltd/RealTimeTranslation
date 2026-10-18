import { afterEach, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { mockEnv } from './helpers';

const origin = 'https://rtt-control.test.invalid';
const scope = { productId: 'rtt', environment: 'preview', origin };
const signingMaterial = 'synthetic-control-signing-material-over32';
const sessionValue = 'A'.repeat(43);
type Envelope = { method: string; path: string; headers: Record<string, string>; body?: string; expectedAccount?: string };

function fixture(refuse = false) {
  const calls: Envelope[] = [];
  const env = mockEnv({ ACCOUNTS_ENABLED: '1', ACCOUNT_ENVIRONMENT: 'preview', ACCOUNT_ORIGIN: origin,
    ACCOUNT_DB: { prepare() {}, batch() {} } as unknown as D1Database,
    IDENTITY_CALLER_ID: 'rtt-control', IDENTITY_CALLER_SECRET: signingMaterial,
    IDENTITY_SERVICE: { async fetch(request: Request) {
      expect(new URL(request.url).pathname).toBe('/v1/browser');
      const raw = await request.text();
      const header = (name: string) => request.headers.get(name) ?? '';
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      const hex = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      const input = ['eugnel-identity-v1', 'rtt-control', 'POST', '/v1/browser', header('Eugnel-Time'), header('Eugnel-Nonce'), hex].join('\n');
      const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingMaterial), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
      const mac = Uint8Array.from(atob(header('Eugnel-Signature').replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
      expect(await crypto.subtle.verify('HMAC', material, mac, new TextEncoder().encode(input))).toBe(true);
      calls.push(JSON.parse(raw) as Envelope);
      return refuse ? Response.json({ error: 'ACCOUNT_CHANGED' }, { status: 401 })
        : Response.json({ enabled: true, scope, session: null, ways: [], capabilities: {} });
    } } as unknown as Fetcher,
  });
  return { env, calls };
}
function request(path: string, method = 'POST', expectation?: string) {
  return new Request(`${origin}${path}`, { method,
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: `__Host-eugnel_session=${sessionValue}`,
      ...(expectation === undefined ? {} : { 'Eugnel-Expected-Account': expectation }) },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
}
afterEach(() => vi.restoreAllMocks());

it.each(['/api/auth/email/start', '/api/auth/email/verify', '/api/auth/signout', '/api/auth/google/cancel', '/api/account/delete', '/api/account/delete/advance'])('signs captured comparison metadata for POST %s without forwarding an authority header', async path => {
  const { env, calls } = fixture();
  expect((await worker.fetch(request(path, 'POST', 'account:alice'), env)).status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0].expectedAccount).toBe('account:alice');
  expect(calls[0].headers).toEqual({ Origin: origin, 'Content-Type': 'application/json', Cookie: `__Host-eugnel_session=${sessionValue}` });
});

it.each(['google', 'apple'])('captures and strips OAuth-start query metadata for %s', async provider => {
  const { env, calls } = fixture();
  expect((await worker.fetch(request(`/api/auth/${provider}/start?retained=1&expectedAccount=account%3Aalice`, 'GET'), env)).status).toBe(200);
  expect(calls[0].expectedAccount).toBe('account:alice');
  expect(calls[0].path).toBe(`/api/auth/${provider}/start?retained=1`);
});

it('keeps the signed-out marker disjoint from canonical account IDs', async () => {
  const { env, calls } = fixture();
  await worker.fetch(request('/api/auth/email/start', 'POST', 'signed-out'), env);
  expect(calls[0].expectedAccount).toBe('signed-out');
});

it.each(['', 'alice', 'account:', `account:${'a'.repeat(129)}`, 'account:alice, account:alice'])('refuses malformed/coalesced control headers before service work', async expectation => {
  const { env, calls } = fixture();
  const response = await worker.fetch(request('/api/auth/signout', 'POST', expectation), env);
  expect(calls).toEqual([]);
  expect(response.status).toBe(400);
});

it.each(['expectedAccount=', 'expectedAccount=account%3Aalice&expectedAccount=account%3Aalice', 'expectedAccount=account%3Aalice&expected%41ccount=account%3Abob', 'expectedAccount=%FF'])('refuses malformed/duplicate OAuth query metadata before service work: %s', async query => {
  const { env, calls } = fixture();
  const response = await worker.fetch(request(`/api/auth/google/start?${query}`, 'GET'), env);
  expect(calls).toEqual([]);
  expect(response.status).toBe(400);
});

it('refuses query/header ambiguity even when values agree', async () => {
  const { env, calls } = fixture();
  const response = await worker.fetch(request('/api/auth/apple/start?expectedAccount=account%3Aalice', 'GET', 'account:alice'), env);
  expect(calls).toEqual([]);
  expect(response.status).toBe(400);
});

it('captures the expectation before an asynchronous body read', async () => {
  const { env, calls } = fixture();
  let started!: () => void;
  let release!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const stream = new ReadableStream<Uint8Array>({ pull(controller) {
    started();
    return new Promise<void>(resolve => { release = () => { controller.enqueue(new TextEncoder().encode('{}')); controller.close(); resolve(); }; });
  } }, { highWaterMark: 0 });
  const req = new Request(`${origin}/api/auth/email/start`, { method: 'POST', body: stream, duplex: 'half',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'Eugnel-Expected-Account': 'account:alice' },
  } as RequestInit);
  const pending = worker.fetch(req, env);
  await reading;
  req.headers.set('Eugnel-Expected-Account', 'account:bob');
  release();
  expect((await pending).status).toBe(200);
  expect(calls[0].expectedAccount).toBe('account:alice');
});

it.each(['/api/account', '/api/auth/capabilities', '/api/auth/google/callback?state=opaque&code=opaque'])('keeps bootstrap/capabilities/provider callbacks independent on %s', async path => {
  const { env, calls } = fixture();
  expect((await worker.fetch(request(path, 'GET', 'malformed'), env)).status).toBe(200);
  expect(calls[0]).not.toHaveProperty('expectedAccount');
  expect(calls[0].headers).not.toHaveProperty('Eugnel-Expected-Account');
});

it('preserves service ACCOUNT_CHANGED refusal without rewriting session cookies', async () => {
  const { env } = fixture(true);
  const response = await worker.fetch(request('/api/auth/signout', 'POST', 'account:bob'), env);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'ACCOUNT_CHANGED' });
  expect(response.headers.getSetCookie()).toEqual([]);
});

it('retains Access, off mode and absence compatibility', async () => {
  const { env, calls } = fixture();
  env.SKIP_ACCESS_CHECK = 'false';
  expect((await worker.fetch(request('/api/auth/signout', 'POST', 'account:alice'), env)).status).toBe(403);
  expect(calls).toEqual([]);
  env.SKIP_ACCESS_CHECK = 'true';
  env.ACCOUNTS_ENABLED = '0';
  expect((await worker.fetch(request('/api/auth/signout', 'POST', 'malformed'), env)).status).toBe(404);
  expect(calls).toEqual([]);
  env.ACCOUNTS_ENABLED = '1';
  expect((await worker.fetch(request('/api/auth/signout'), env)).status).toBe(200);
  expect(calls[0]).not.toHaveProperty('expectedAccount');
});

it('accepts the same header grammar on a user OAuth start', async () => {
  const { env, calls } = fixture();
  expect((await worker.fetch(request('/api/auth/google/start', 'GET', 'account:alice'), env)).status).toBe(200);
  expect(calls[0].expectedAccount).toBe('account:alice');
});

it('retains a canonical ID at the exact 128-character boundary', async () => {
  const { env, calls } = fixture();
  const expectation = `account:${'a'.repeat(128)}`;
  expect((await worker.fetch(request('/api/auth/signout', 'POST', expectation), env)).status).toBe(200);
  expect(calls[0].expectedAccount).toBe(expectation);
});
