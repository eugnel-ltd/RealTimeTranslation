import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy, type PlatformProxy } from 'wrangler';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { resetAccessJwksCache } from '../worker/src/access';
import type { WorkerEnv } from '../worker/src/env';
import { jsonResponse, mockEnv, mockKv } from './helpers';

const origin = 'https://rtt-account.test.invalid';
const issuer = 'https://access-account.test.invalid';
const scope = { productId: 'rtt', environment: 'preview', origin };
const caller = 'rtt-test-product';
const callerSecret = 'synthetic-product-signature-secret-'.repeat(2);
const eraserCaller = 'rtt-test-eraser';
const eraserSecret = 'synthetic-coordinator-signature-secret-'.repeat(2);
const tokens = { alice: 'A'.repeat(43), bob: 'B'.repeat(43) };
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = async (text: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));

type AccountEnv = WorkerEnv & {
  ACCOUNTS_ENABLED?: string; IDENTITY_SERVICE?: Fetcher; IDENTITY_CALLER_ID?: string; IDENTITY_CALLER_SECRET?: string;
  ACCOUNT_DB?: D1Database; ACCOUNT_ENVIRONMENT?: string; ACCOUNT_ORIGIN?: string;
  IDENTITY_ERASER_CALLER?: string; IDENTITY_ERASER_SECRET?: string;
};
type ProviderCall = { url: string; body: string };
let proxy: PlatformProxy<{ ACCOUNT_DB: D1Database }>;
let db: D1Database;
let directory: string;
let accessToken: string;
let keys: Awaited<ReturnType<typeof exportJWK>>[];
let providerCalls: ProviderCall[];
let identityCalls: Array<{ path: string; payload: Record<string, unknown>; signed: boolean }>;
let returnedScope: typeof scope;
let returnedSession: 'normal' | 'none' | 'expired';
let kv: KVNamespace;
let kvReads: ReturnType<typeof vi.spyOn>;
let kvWrites: ReturnType<typeof vi.spyOn>;

// This independent test peer checks the documented wire MAC, not an imported
// unreleased helper. The old Worker therefore fails actual behavior assertions.
async function signed(request: Request, expectedCaller: string, secret: string) {
  const raw = await request.clone().text();
  const url = new URL(request.url);
  const name = request.headers.get('Eugnel-Caller');
  const time = request.headers.get('Eugnel-Time') ?? '';
  const nonce = request.headers.get('Eugnel-Nonce') ?? '';
  const signature = request.headers.get('Eugnel-Signature') ?? '';
  if (name !== expectedCaller || request.method !== 'POST' || url.search ||
      !/^[A-Za-z0-9_-]{22}$/.test(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(signature) ||
      Math.abs(Date.now() / 1000 - Number(time)) > 60) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const input = ['eugnel-identity-v1', name, 'POST', url.pathname, time, nonce, await sha(raw)].join('\n');
  const bytes = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(input));
}

async function erasure(payload: Record<string, unknown> = { accountId: 'alice', jobId: 'delete-alice' }, identity = eraserCaller, secret = eraserSecret) {
  const path = '/_internal/identity/erase';
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = b64(crypto.getRandomValues(new Uint8Array(16)));
  const input = ['eugnel-identity-v1', identity, 'POST', path, timestamp, nonce, await sha(body)].join('\n');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(input))));
  return new Request(`${origin}${path}`, { method: 'POST', body, headers: {
    'Content-Type': 'application/json', 'Eugnel-Caller': identity, 'Eugnel-Time': timestamp, 'Eugnel-Nonce': nonce, 'Eugnel-Signature': signature,
  } });
}

function environment(overrides: Partial<AccountEnv> = {}): AccountEnv {
  const binding = { async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    const payload = await request.clone().json() as Record<string, unknown>;
    const valid = await signed(request, caller, callerSecret);
    identityCalls.push({ path, payload, signed: valid });
    if (!valid || path !== '/v1/session' || Object.keys(payload).join(',') !== 'token') return jsonResponse({ error: 'CALLER_INVALID' }, 403);
    const accountId = payload.token === tokens.alice ? 'alice' : payload.token === tokens.bob ? 'bob' : null;
    return jsonResponse({ scope: returnedScope, session: accountId && returnedSession !== 'none' ? {
      accountId, authenticatedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + (returnedSession === 'expired' ? -1 : 60_000)).toISOString(),
    } : null });
  } } as unknown as Fetcher;
  return Object.assign(mockEnv({ PROFILES: kv, SKIP_ACCESS_CHECK: 'false', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'account-proof', GEMINI_API_KEY: 'synthetic', AZURE_SPEECH_KEY: 'synthetic' }), {
    ACCOUNTS_ENABLED: '1', IDENTITY_SERVICE: binding, IDENTITY_CALLER_ID: caller, IDENTITY_CALLER_SECRET: callerSecret,
    ACCOUNT_DB: db, ACCOUNT_ENVIRONMENT: 'preview', ACCOUNT_ORIGIN: origin,
    IDENTITY_ERASER_CALLER: eraserCaller, IDENTITY_ERASER_SECRET: eraserSecret,
  }, overrides);
}

function request(path: string, account: keyof typeof tokens | null = 'alice', method = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, { method, headers: {
    'Cf-Access-Jwt-Assertion': accessToken,
    ...(method === 'GET' ? {} : { Origin: origin }),
    ...(account ? { Cookie: `__Host-eugnel_session=${tokens[account]}` } : {}), ...extraHeaders,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function rows(account: string) { return (await db.prepare('SELECT profile_id,name,markdown FROM account_profiles WHERE account_id=?1 ORDER BY profile_id').bind(account).all()).results; }

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rtt-account-contract-'));
  const configPath = join(directory, 'wrangler.toml');
  await writeFile(configPath, 'name="rtt-account-local-test"\ncompatibility_date="2026-10-01"\n[[d1_databases]]\nbinding="ACCOUNT_DB"\ndatabase_name="local-only-synthetic"\ndatabase_id="00000000-0000-0000-0000-000000000000"\n');
  proxy = await getPlatformProxy<{ ACCOUNT_DB: D1Database }>({ configPath, persist: false });
  db = proxy.env.ACCOUNT_DB;
  // Contract fixture exists on old source too: no missing migration/import can
  // masquerade as proof that owner-global reads/writes were already isolated.
  await db.batch([
    db.prepare('CREATE TABLE account_profiles(account_id TEXT NOT NULL,profile_id TEXT NOT NULL CHECK(profile_id IN (\'james\',\'wing\')),name TEXT NOT NULL,markdown TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(account_id,profile_id))'),
    db.prepare('CREATE TABLE account_profile_fences(account_id TEXT PRIMARY KEY,deletion_job TEXT NOT NULL,fenced_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE auth_service_nonces(caller_id TEXT NOT NULL,nonce_hash TEXT NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(caller_id,nonce_hash))'),
  ]);
  const pair = await generateKeyPair('RS256');
  keys = [{ ...await exportJWK(pair.publicKey), kid: 'account-contract-access', alg: 'RS256', use: 'sig' }];
  accessToken = await new SignJWT({ sub: 'synthetic-access-user' }).setProtectedHeader({ alg: 'RS256', kid: 'account-contract-access' })
    .setIssuer(issuer).setAudience('account-proof').setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
}, 30_000);

beforeEach(async () => {
  resetAccessJwksCache();
  providerCalls = []; identityCalls = []; returnedScope = { ...scope }; returnedSession = 'normal';
  await db.batch([db.prepare('DELETE FROM account_profiles'), db.prepare('DELETE FROM account_profile_fences'), db.prepare('DELETE FROM auth_service_nonces')]);
  for (const account of ['alice', 'bob']) await db.prepare('INSERT INTO account_profiles VALUES (?1,?2,?3,?4,?5)')
    .bind(account, 'james', `${account} candidate`, `${account}-private-profile`, new Date().toISOString()).run();
  kv = mockKv({ 'profile:james': { value: 'legacy-owner-private-profile', metadata: { name: 'Legacy owner' } } });
  kvReads = vi.spyOn(kv, 'getWithMetadata'); kvWrites = vi.spyOn(kv, 'put');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === `${issuer}/cdn-cgi/access/certs`) return jsonResponse({ keys });
    providerCalls.push({ url, body: String(init?.body ?? '') });
    if (url.includes('sts/v1.0/issueToken')) return new Response('synthetic-speech-token');
    return new Response('data: {"candidates":[{"content":{"parts":[{"text":"Synthetic answer"}]},"finishReason":"STOP"}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await proxy?.dispose(); await rm(directory, { recursive: true, force: true }); }, 30_000);

describe('Access and verified customer identity before owner data or paid APIs', () => {
  it('keeps Access first even when account configuration is missing', async () => {
    const req = request('/api/profiles/james'); req.headers.delete('Cf-Access-Jwt-Assertion');
    const response = await worker.fetch(req, environment({ ACCOUNT_DB: undefined }));
    expect(response.status).toBe(403); expect(identityCalls).toHaveLength(0); expect(kvReads).not.toHaveBeenCalled(); expect(providerCalls).toHaveLength(0);
  });
  it.each(['IDENTITY_SERVICE', 'IDENTITY_CALLER_ID', 'IDENTITY_CALLER_SECRET', 'ACCOUNT_DB', 'ACCOUNT_ENVIRONMENT', 'ACCOUNT_ORIGIN'] as const)('refuses enabled missing %s instead of falling back to owner KV', async field => {
    const response = await worker.fetch(request('/api/profiles/james'), environment({ [field]: undefined }));
    expect(response.status).toBe(503); expect(kvReads).not.toHaveBeenCalled(); expect(identityCalls).toHaveLength(0);
  });
  it.each([
    ['/api/speech-token', 'GET', undefined], ['/api/translate', 'POST', { text: 'Hello', to: ['fr'] }],
    ['/api/gemini-token', 'POST', { mode: 'transcribe' }], ['/api/gemini-live', 'GET', undefined],
    ['/api/detect-question', 'POST', { segments: [{ index: 0, text: 'Why?' }] }],
    ['/api/answer', 'POST', { question: 'Why?', force: true }], ['/api/profiles/james', 'GET', undefined],
  ] as const)('requires a customer session before %s', async (path, method, body) => {
    const response = await worker.fetch(request(path, null, method, body), environment());
    expect(response.status).toBe(401); expect(providerCalls).toHaveLength(0); expect(kvReads).not.toHaveBeenCalled(); expect(kvWrites).not.toHaveBeenCalled();
  });
  it.each(['none', 'expired'] as const)('refuses a %s verified session', async mode => {
    returnedSession = mode;
    const response = await worker.fetch(request('/api/profiles/james'), environment());
    expect(response.status).toBe(401); expect(kvReads).not.toHaveBeenCalled(); expect(providerCalls).toHaveLength(0);
  });
  it('does not accept a correctly shaped but unverified session token', async () => {
    const response = await worker.fetch(request('/api/profiles/james', 'alice', 'GET', undefined, { Cookie: `__Host-eugnel_session=${'Z'.repeat(43)}` }), environment());
    expect(response.status).toBe(401); expect(kvReads).not.toHaveBeenCalled(); expect(providerCalls).toHaveLength(0);
  });
  it.each([{ productId: 'wordcamp' }, { environment: 'production' }, { origin: 'https://another.test.invalid' }])('refuses a service scope mismatch %j', async replacement => {
    returnedScope = { ...scope, ...replacement };
    const response = await worker.fetch(request('/api/profiles/james'), environment());
    expect(response.status).toBe(503); expect(kvReads).not.toHaveBeenCalled();
  });
  it('rejects duplicate session cookies instead of choosing an account', async () => {
    const response = await worker.fetch(request('/api/profiles/james', 'alice', 'GET', undefined, { Cookie: `__Host-eugnel_session=${tokens.alice}; __Host-eugnel_session=${tokens.bob}` }), environment());
    expect(response.status).toBe(400); expect(identityCalls).toHaveLength(0); expect(kvReads).not.toHaveBeenCalled();
  });
  it.each([undefined, '0', 'true'])('retains the owner KV path only with the off/nonexact flag %s', async enabled => {
    const response = await worker.fetch(request('/api/profiles/james'), environment({ ACCOUNTS_ENABLED: enabled }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ markdown: 'legacy-owner-private-profile' }); expect(identityCalls).toHaveLength(0);
  });
});

describe('same profile ID isolated across verified accounts', () => {
  it('reads and lists only the session account and signs a token-only service request', async () => {
    for (const account of ['alice', 'bob'] as const) {
      const profile = await worker.fetch(request('/api/profiles/james', account), environment());
      expect(await profile.json()).toMatchObject({ name: `${account} candidate`, markdown: `${account}-private-profile` });
      const listed = await worker.fetch(request('/api/profiles', account), environment());
      expect(await listed.json()).toMatchObject({ profiles: [{ id: 'james', name: `${account} candidate` }, { id: 'wing' }] });
    }
    expect(identityCalls).toHaveLength(4); expect(identityCalls.every(call => call.signed && call.path === '/v1/session' && Object.keys(call.payload).join(',') === 'token')).toBe(true);
    expect(kvReads).not.toHaveBeenCalled();
  });
  it('writes only the verified account despite forged account fields and leaves owner KV intact', async () => {
    const response = await worker.fetch(request('/api/profiles/james', 'alice', 'PUT', { name: 'Alice revised', markdown: 'alice revised', accountId: 'bob' }, { 'X-Account-Id': 'bob' }), environment());
    expect(response.status).toBe(200);
    expect(await rows('alice')).toMatchObject([{ name: 'Alice revised', markdown: 'alice revised' }]);
    expect(await rows('bob')).toMatchObject([{ markdown: 'bob-private-profile' }]);
    expect(await kv.get('profile:james')).toBe('legacy-owner-private-profile'); expect(kvWrites).not.toHaveBeenCalled();
  });
  it.each(['missing', 'cross-origin'])('refuses a %s Origin before a customer profile mutation', async mode => {
    const req = request('/api/profiles/james', 'alice', 'PUT', { markdown: 'cross-site mutation' });
    if (mode === 'missing') req.headers.delete('Origin');
    else req.headers.set('Origin', 'https://another.test.invalid');
    const mutations: string[] = [];
    const observed = new Proxy(db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => { if (/\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql)) mutations.push(sql); return target.prepare(sql); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const response = await worker.fetch(req, environment({ ACCOUNT_DB: observed }));
    expect(response.status).toBe(403); expect(await rows('alice')).toMatchObject([{ markdown: 'alice-private-profile' }]); expect(mutations).toEqual([]); expect(kvWrites).not.toHaveBeenCalled();
  });
  it('loads only the current account profile into answer prompts', async () => {
    for (const account of ['alice', 'bob'] as const) {
      const response = await worker.fetch(request('/api/answer', account, 'POST', { question: 'Why?', force: true, profileId: 'james', accountId: account === 'alice' ? 'bob' : 'alice' }), environment());
      expect(response.status).toBe(200); await response.text();
      const prompt = providerCalls.at(-1)?.body ?? '';
      expect(prompt).toContain(`${account}-private-profile`); expect(prompt).not.toContain(account === 'alice' ? 'bob-private-profile' : 'alice-private-profile'); expect(prompt).not.toContain('legacy-owner-private-profile');
    }
    expect(kvReads).not.toHaveBeenCalled();
  });
  it('preserves the existing UTF-8 profile size boundary without writing either store', async () => {
    const response = await worker.fetch(request('/api/profiles/james', 'alice', 'PUT', { markdown: '🙂'.repeat(200 * 1024 / 4 + 1) }), environment());
    expect(response.status).toBe(413); expect(await rows('alice')).toMatchObject([{ markdown: 'alice-private-profile' }]); expect(kvWrites).not.toHaveBeenCalled();
  });
  it.each([
    ['ASCII at 256 bytes', 'n'.repeat(256), 200], ['ASCII over 256 bytes', 'n'.repeat(257), 413],
    ['Unicode at 256 bytes', '🙂'.repeat(64), 200], ['Unicode over 256 bytes', '🙂'.repeat(65), 413],
  ] as const)('enforces the customer name UTF-8 boundary: %s', async (_label, name, status) => {
    const response = await worker.fetch(request('/api/profiles/james', 'alice', 'PUT', { name, markdown: 'unchanged' }), environment());
    expect(response.status).toBe(status); expect(await rows('alice')).toMatchObject([{ name: status === 200 ? name : 'alice candidate' }]); expect(kvWrites).not.toHaveBeenCalled();
  });
  it('refuses a database read error without exposing its detail or using owner KV', async () => {
    const broken = new Proxy(db, { get(target, key) {
      if (key === 'prepare') return () => { throw new Error('private-database-error-marker'); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const response = await worker.fetch(request('/api/profiles/james'), environment({ ACCOUNT_DB: broken }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-database-error-marker'); expect(kvReads).not.toHaveBeenCalled();
  });
  it('does not acknowledge a profile write with an unknown D1 result', async () => {
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
      if (key === 'run') return async () => ({ success: true, meta: {} });
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const uncertain = new Proxy(db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => /^\s*INSERT\s+INTO\s+account_profiles\b/i.test(sql) ? wrap(target.prepare(sql)) : target.prepare(sql);
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const response = await worker.fetch(request('/api/profiles/james', 'alice', 'PUT', { markdown: 'uncertain' }), environment({ ACCOUNT_DB: uncertain }));
    expect(response.status).toBe(503); expect(await rows('alice')).toMatchObject([{ markdown: 'alice-private-profile' }]); expect(kvWrites).not.toHaveBeenCalled();
  });
});

describe('authenticated permanent product erasure and commit fence', () => {
  it('erases exactly one account atomically and acknowledges fresh signed retries', async () => {
    for (let retry = 0; retry < 2; retry++) {
      const response = await worker.fetch(await erasure(), environment());
      expect(await rows('alice')).toEqual([]); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, jobId: 'delete-alice' });
    }
    expect(await rows('bob')).toMatchObject([{ markdown: 'bob-private-profile' }]);
    expect((await db.prepare('SELECT account_id FROM account_profile_fences WHERE account_id=?1').bind('alice').all()).results).toHaveLength(1);
    expect(await kv.get('profile:james')).toBe('legacy-owner-private-profile');
  });
  it('refuses the product sign-in caller as an eraser and ignores unsigned account headers', async () => {
    const response = await worker.fetch(await erasure(undefined, caller, callerSecret), environment());
    expect(response.status).toBe(403); expect(await rows('alice')).toHaveLength(1); expect(await rows('bob')).toHaveLength(1);
  });
  it('refuses a forged signature and an exact nonce replay', async () => {
    const forged = await erasure(); forged.headers.set('Eugnel-Signature', 'Z'.repeat(43));
    expect((await worker.fetch(forged, environment())).status).toBe(403); expect(await rows('alice')).toHaveLength(1);
    const valid = await erasure();
    const copy = new Request(valid.url, { method: 'POST', headers: valid.headers, body: await valid.clone().text() });
    expect((await worker.fetch(copy, environment())).status).toBe(200);
    expect((await worker.fetch(valid, environment())).status).toBe(403);
    expect(await rows('bob')).toHaveLength(1);
  });
  it('refuses caller-selected scope in the erasure payload', async () => {
    const response = await worker.fetch(await erasure({ accountId: 'alice', jobId: 'delete-alice', scope: { ...scope, productId: 'wordcamp' } }), environment());
    expect(response.status).toBe(400); expect(await rows('alice')).toHaveLength(1);
  });
  it('does not acknowledge erasure when the D1 transaction returns an unknown result', async () => {
    const uncertain = new Proxy(db, { get(target, key) {
      if (key === 'batch') return async () => [];
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const response = await worker.fetch(await erasure(), environment({ ACCOUNT_DB: uncertain }));
    expect(response.status).toBe(503); expect(await rows('alice')).toHaveLength(1); expect(await rows('bob')).toHaveLength(1);
  });
  it.each([['/api/profiles', 'GET', undefined], ['/api/profiles/james', 'GET', undefined], ['/api/profiles/james', 'PUT', { markdown: 'resurrect' }], ['/api/answer', 'POST', { question: 'Why?', force: true, profileId: 'james' }], ['/api/answer', 'POST', { question: 'Why?', force: true }], ['/api/speech-token', 'GET', undefined]] as const)('refuses fenced account use at %s %s even after service verification', async (path, method, body) => {
    await db.prepare('INSERT INTO account_profile_fences VALUES (?1,?2,?3)').bind('alice', 'existing-delete', new Date().toISOString()).run();
    const response = await worker.fetch(request(path, 'alice', method, body), environment());
    expect(response.status).toBe(401); expect(providerCalls).toHaveLength(0); expect(kvReads).not.toHaveBeenCalled(); expect(kvWrites).not.toHaveBeenCalled();
  });
  it('prevents a real D1 write paused before SQL from resurrecting an erased profile', async () => {
    let entered = false;
    let release!: () => void;
    let signal!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { signal = resolve; });
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
      if (key === 'run') return async () => { entered = true; signal(); await gate; return target.run(); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const pausedDb = new Proxy(db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => /^\s*INSERT\s+INTO\s+account_profiles\b/i.test(sql) ? wrap(target.prepare(sql)) : target.prepare(sql);
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const writing = worker.fetch(request('/api/profiles/james', 'alice', 'PUT', { markdown: 'late-write' }), environment({ ACCOUNT_DB: pausedDb }));
    try {
      await Promise.race([reached, writing.then(() => undefined)]);
      expect(entered, 'Customer writes must reach account-scoped conditional D1 SQL, never global KV').toBe(true);
      expect((await worker.fetch(await erasure(), environment())).status).toBe(200);
      release();
      expect((await writing).status).toBe(401);
      expect(await rows('alice')).toEqual([]); expect(await rows('bob')).toHaveLength(1); expect(kvWrites).not.toHaveBeenCalled();
    } finally { release(); await writing; }
  });
});
