import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy, type PlatformProxy } from 'wrangler';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { resetAccessJwksCache } from '../worker/src/access';
import type { WorkerEnv } from '../worker/src/env';
import { mockEnv, mockKv } from './helpers';

const origin = 'https://rtt-consistency.test.invalid';
const issuer = 'https://rtt-consistency-access.test.invalid';
const sessionValue = 'A'.repeat(43);
const scope = { productId: 'rtt', environment: 'preview', origin };
const signingMaterial = 'synthetic-consistency-signing-material-over32';
let proxy: PlatformProxy<{ DB: D1Database }>;
let directory: string;
let access: string;
let jwks: Awaited<ReturnType<typeof exportJWK>>[];
let env: WorkerEnv;
let productOperations: string[];
let providerCalls: string[];
let sessionPayloads: unknown[];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rtt-request-consistency-'));
  const configPath = join(directory, 'wrangler.toml');
  await writeFile(configPath, 'name="rtt-consistency-local"\ncompatibility_date="2026-10-09"\n[[d1_databases]]\nbinding="DB"\ndatabase_name="synthetic-local"\ndatabase_id="00000000-0000-0000-0000-000000000000"\n');
  proxy = await getPlatformProxy({ configPath, persist: false });
  await proxy.env.DB.batch([
    proxy.env.DB.prepare('CREATE TABLE account_profiles(account_id TEXT,profile_id TEXT,name TEXT,markdown TEXT,updated_at TEXT,PRIMARY KEY(account_id,profile_id))'),
    proxy.env.DB.prepare('CREATE TABLE account_profile_fences(account_id TEXT PRIMARY KEY,deletion_job TEXT,fenced_at TEXT)'),
    proxy.env.DB.prepare("INSERT INTO account_profiles VALUES('alice','james','Alice','alice-private-profile','2026-10-18')"),
  ]);
  const pair = await generateKeyPair('RS256');
  jwks = [{ ...await exportJWK(pair.publicKey), kid: 'consistency-access', alg: 'RS256', use: 'sig' }];
  access = await new SignJWT({ sub: 'synthetic-access' }).setProtectedHeader({ alg: 'RS256', kid: 'consistency-access' })
    .setIssuer(issuer).setAudience('consistency-proof').setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
}, 30_000);
beforeEach(async () => {
  resetAccessJwksCache();
  productOperations = []; providerCalls = []; sessionPayloads = [];
  const db = proxy.env.DB;
  await db.prepare("UPDATE account_profiles SET name='Alice',markdown='alice-private-profile' WHERE account_id='alice' AND profile_id='james'").run();
  env = mockEnv({ ACCOUNTS_ENABLED: '1', ACCOUNT_ENVIRONMENT: 'preview', ACCOUNT_ORIGIN: origin,
    ACCOUNT_DB: { prepare(sql: string) { productOperations.push(sql); return db.prepare(sql); }, batch: db.batch.bind(db) } as D1Database,
    IDENTITY_CALLER_ID: 'rtt-consistency', IDENTITY_CALLER_SECRET: signingMaterial,
    IDENTITY_SERVICE: { async fetch(request: Request) {
      expect(new URL(request.url).pathname).toBe('/v1/session');
      sessionPayloads.push(await request.json());
      return Response.json({ scope, session: { accountId: 'alice', authenticatedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() } });
    } } as unknown as Fetcher,
    SKIP_ACCESS_CHECK: 'false', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'consistency-proof',
    GEMINI_API_KEY: signingMaterial, AZURE_SPEECH_KEY: signingMaterial,
    PROFILES: mockKv({ 'profile:james': { value: 'legacy-owner-profile', metadata: { name: 'Owner' } } }),
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input) === `${issuer}/cdn-cgi/access/certs`) return Response.json({ keys: jwks });
    providerCalls.push(String(input));
    return new Response('synthetic-provider-response');
  });
  vi.stubGlobal('WebSocketPair', class {
    0 = { accept() {}, close() {} };
    1 = { accept() {}, close() {} };
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await proxy?.dispose(); await rm(directory, { recursive: true, force: true }); }, 30_000);

function request(path: string, method = 'GET', body?: unknown, expectation?: string) {
  const headers = new Headers({ 'Cf-Access-Jwt-Assertion': access, Cookie: `__Host-eugnel_session=${sessionValue}`, Origin: origin, 'Content-Type': 'application/json' });
  if (expectation !== undefined) headers.set('Eugnel-Expected-Account', expectation);
  if (path.startsWith('/api/gemini-live')) headers.set('Upgrade', 'websocket');
  return new Request(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

it.each([
  ['/api/profiles', 'GET', undefined], ['/api/profiles/james', 'GET', undefined],
  ['/api/profiles/james', 'PUT', { name: 'Bob', markdown: 'bob-personal-body' }],
  ['/api/answer', 'POST', { question: 'bob-personal-question', profileId: 'james', force: true }],
  ['/api/speech-token', 'GET', undefined], ['/api/gemini-token', 'POST', { mode: 'transcribe' }],
  ['/api/translate', 'POST', { text: 'bob-personal-body', to: ['fr'] }],
  ['/api/detect-question', 'POST', { segments: [{ index: 0, text: 'bob-personal-question' }] }],
] as const)('refuses a stale expected account before product/provider operations on %s', async (path, method, body) => {
  const response = await worker.fetch(request(path, method, body, 'account:bob'), env);
  expect(productOperations).toEqual([]);
  expect(providerCalls).toEqual([]);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'ACCOUNT_CHANGED' });
  expect(sessionPayloads).toEqual([{ token: sessionValue }]);
});

it('refuses a native WebSocket query mismatch before database access or upstream upgrade', async () => {
  const response = await worker.fetch(request('/api/gemini-live?expectedAccount=account%3Abob'), env);
  expect(productOperations).toEqual([]);
  expect(providerCalls).toEqual([]);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'ACCOUNT_CHANGED' });
});

it.each(['account:alice', undefined])('keeps matching and absent HTTP preconditions compatible: %s', async expectation => {
  const response = await worker.fetch(request('/api/profiles/james', 'GET', undefined, expectation), env);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ markdown: 'alice-private-profile' });
  expect(productOperations.length).toBeGreaterThan(0);
  expect(sessionPayloads).toEqual([{ token: sessionValue }]);
});

it('a matching native WebSocket expectation reaches the existing upstream handler', async () => {
  const response = await worker.fetch(request('/api/gemini-live?expectedAccount=account%3Aalice'), env);
  expect(response.status).toBe(502); // Injected provider deliberately has no WebSocket.
  expect(providerCalls).toHaveLength(1);
  expect(productOperations.length).toBeGreaterThan(0);
});

it.each(['', 'alice', 'account:', `account:${'a'.repeat(129)}`, 'account:alice, account:alice', 'account:alice\tbob'])('refuses malformed or coalesced expected-account headers', async expectation => {
  const response = await worker.fetch(request('/api/profiles/james', 'GET', undefined, expectation), env);
  expect(response.status).toBe(400);
  expect(productOperations).toEqual([]);
  expect(providerCalls).toEqual([]);
});

it.each(['expectedAccount=', 'expectedAccount=account%3Aalice&expectedAccount=account%3Aalice', 'expectedAccount=account%3Aalice&expected%41ccount=account%3Abob', 'expectedAccount=%FF', 'expectedAccount=%00'])('refuses malformed or duplicate native query expectations: %s', async query => {
  const response = await worker.fetch(request(`/api/gemini-live?${query}`), env);
  expect(response.status).toBe(400);
  expect(productOperations).toEqual([]);
  expect(providerCalls).toEqual([]);
});

it('refuses simultaneous query/header expectations rather than selecting one', async () => {
  expect((await worker.fetch(request('/api/gemini-live?expectedAccount=account%3Aalice', 'GET', undefined, 'account:alice'), env)).status).toBe(400);
  expect(productOperations).toEqual([]);
  expect(providerCalls).toEqual([]);
});

it('retains Access before the consistency precondition', async () => {
  const req = request('/api/profiles/james', 'GET', undefined, 'account:bob');
  req.headers.delete('Cf-Access-Jwt-Assertion');
  expect((await worker.fetch(req, env)).status).toBe(403);
  expect(sessionPayloads).toEqual([]);
  expect(productOperations).toEqual([]);
  expect(providerCalls).toEqual([]);
});

it('keeps the disabled owner path unchanged even with stale optional metadata', async () => {
  env.ACCOUNTS_ENABLED = '0';
  const response = await worker.fetch(request('/api/profiles/james', 'GET', undefined, 'account:bob'), env);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ markdown: 'legacy-owner-profile' });
  expect(sessionPayloads).toEqual([]);
  expect(productOperations).toEqual([]);
});

it('a signed-out expectation cannot authorize a request after the cookie switches to a signed-in account', async () => {
  const response = await worker.fetch(request('/api/profiles/james', 'GET', undefined, 'signed-out'), env);
  expect(productOperations).toEqual([]);
  expect(providerCalls).toEqual([]);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'ACCOUNT_CHANGED' });
});

it('a matching HTTP expectation permits the normal paid token route', async () => {
  const response = await worker.fetch(request('/api/speech-token', 'GET', undefined, 'account:alice'), env);
  expect(response.status).toBe(200);
  expect(providerCalls).toHaveLength(1);
  expect(productOperations.length).toBeGreaterThan(0);
});
