import { createIdentityService } from 'eugnel-platform/auth/identity';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy, type PlatformProxy } from 'wrangler';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { resetAccessJwksCache } from '../worker/src/access';
import type { WorkerEnv } from '../worker/src/env';
import { mockEnv, mockKv } from './helpers';

const origin = 'https://rtt-composed.test.invalid';
const issuer = 'https://rtt-access.test.invalid';
const scope = { productId: 'rtt', environment: 'preview' as const, origin };
const productCaller = 'rtt-composed-product';
const productMaterial = 'synthetic-composed-product-signing-material-over32';
const eraserCaller = 'rtt-composed-eraser';
const eraserMaterial = 'synthetic-composed-eraser-signing-material-over32';
const rateMaterial = 'synthetic-composed-rate-hashing-material-over32';
const require = createRequire(import.meta.url);
let directory: string;
let proxy: PlatformProxy<{ IDENTITY_DB: D1Database; PRODUCT_DB: D1Database }>;
let access: string;
let jwks: Awaited<ReturnType<typeof exportJWK>>[];

async function migrate(db: D1Database, path: string) {
  const sql = (await readFile(path, 'utf8')).replace(/--[^\n]*/g, '');
  await db.batch(sql.split(';').filter(part => part.trim()).map(part => db.prepare(part)));
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rtt-composed-d1-'));
  const configPath = join(directory, 'wrangler.toml');
  await writeFile(configPath, 'name="rtt-composed-local"\ncompatibility_date="2026-10-09"\n'
    + '[[d1_databases]]\nbinding="IDENTITY_DB"\ndatabase_name="synthetic-identity-local"\ndatabase_id="00000000-0000-0000-0000-000000000001"\n'
    + '[[d1_databases]]\nbinding="PRODUCT_DB"\ndatabase_name="synthetic-product-local"\ndatabase_id="00000000-0000-0000-0000-000000000002"\n');
  proxy = await getPlatformProxy({ configPath, persist: false });
  for (const file of ['0001_scoped_sessions.sql', '0002_identity_proofs.sql', '0003_identity_service.sql']) {
    await migrate(proxy.env.IDENTITY_DB, require.resolve(`eugnel-platform/auth/migrations/d1/${file}`));
  }
  await migrate(proxy.env.PRODUCT_DB, new URL('../worker/migrations/0001_account_profiles.sql', import.meta.url).pathname);
  const pair = await generateKeyPair('RS256');
  jwks = [{ ...await exportJWK(pair.publicKey), kid: 'composed-local-access', alg: 'RS256', use: 'sig' }];
  access = await new SignJWT({ sub: 'synthetic-access' }).setProtectedHeader({ alg: 'RS256', kid: 'composed-local-access' })
    .setIssuer(issuer).setAudience('composed-proof').setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
}, 30_000);
afterEach(() => { vi.restoreAllMocks(); resetAccessJwksCache(); });
afterAll(async () => { await proxy?.dispose(); await rm(directory, { recursive: true, force: true }); }, 30_000);

it('composes real scoped signup, profiles, answers, signout and identity-last product erasure across two local D1 databases', async () => {
  const identityDb = proxy.env.IDENTITY_DB;
  const productDb = proxy.env.PRODUCT_DB;
  const kv = mockKv({ 'profile:james': { value: 'legacy-owner-profile', metadata: { name: 'Owner' } } });
  const kvRead = vi.spyOn(kv, 'getWithMetadata');
  const kvWrite = vi.spyOn(kv, 'put');
  const deliveries: Array<{ email: string; code: string }> = [];
  const answers: string[] = [];
  const reverse: Array<{ accountId: string; jobId: string; identityPresent: boolean; fenced: boolean }> = [];
  const reports: string[] = [];
  let env: WorkerEnv;
  let refuseErasure = true;
  const service = createIdentityService({ enabled: '1', db: identityDb,
    registry: [{ callerId: productCaller, secret: productMaterial, scope, actions: ['browser', 'session'],
      config: { rateKey: rateMaterial, returnPath: '/', turnstile: { siteKey: 'synthetic-public-site', secret: rateMaterial } } }],
    quota: { forCaller: () => ({ available: true, async sendCode(message) { deliveries.push(message); return { ok: true }; },
      async reserve() { return { status: 503, error: 'unused' }; }, async settle() { return false; } }) },
    fetchImpl: async input => {
      expect(String(input)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
      return Response.json({ success: true, hostname: new URL(origin).hostname });
    },
    reportError: category => { reports.push(category); },
    erasers: [{ id: 'rtt-preview', scope, callerId: eraserCaller, secret: eraserMaterial,
      binding: { async fetch(request) {
        const payload = await request.clone().json() as { accountId: string; jobId: string };
        const identityPresent = (await identityDb.prepare('SELECT id FROM accounts WHERE id=?1').bind(payload.accountId).all()).results.length === 1;
        const fenced = (await identityDb.prepare('SELECT account_id FROM auth_session_fences WHERE account_id=?1').bind(payload.accountId).all()).results.length === 1;
        reverse.push({ ...payload, identityPresent, fenced });
        if (refuseErasure) return Response.json({ error: 'synthetic-unavailable' }, { status: 503 });
        return worker.fetch(new Request(`${origin}${new URL(request.url).pathname}`, request), env);
      } } }],
  });
  env = mockEnv({ ACCOUNTS_ENABLED: '1', ACCOUNT_ENVIRONMENT: 'preview', ACCOUNT_ORIGIN: origin, ACCOUNT_DB: productDb,
    IDENTITY_CALLER_ID: productCaller, IDENTITY_CALLER_SECRET: productMaterial, IDENTITY_SERVICE: service as unknown as Fetcher,
    IDENTITY_ERASER_CALLER: eraserCaller, IDENTITY_ERASER_SECRET: eraserMaterial,
    SKIP_ACCESS_CHECK: 'false', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'composed-proof', PROFILES: kv, GEMINI_API_KEY: rateMaterial });
  resetAccessJwksCache();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input) === `${issuer}/cdn-cgi/access/certs`) return Response.json({ keys: jwks });
    answers.push(String(init?.body ?? ''));
    return new Response('data: {"candidates":[{"content":{"parts":[{"text":"Synthetic answer"}]},"finishReason":"STOP"}]}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const call = (path: string, cookie?: string, method = 'GET', body?: unknown) => worker.fetch(new Request(`${origin}${path}`, {
    method, headers: { 'Cf-Access-Jwt-Assertion': access, Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.20', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
  const identityRows = async (id: string) => (await identityDb.prepare('SELECT id FROM accounts WHERE id=?1').bind(id).all()).results;
  const profileRows = async (id: string) => (await productDb.prepare('SELECT profile_id FROM account_profiles WHERE account_id=?1').bind(id).all()).results;
  async function signup(name: string) {
    const email = `${name}@example.test`;
    expect((await call('/api/auth/email/start', undefined, 'POST', { email, turnstile: 'synthetic-proof' })).status).toBe(200);
    const mail = deliveries.at(-1)!;
    expect(mail.email).toBe(email);
    const response = await call('/api/auth/email/verify', undefined, 'POST', { email, code: mail.code });
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('__Host-eugnel_session='))?.split(';')[0];
    expect(cookie).toMatch(/^__Host-eugnel_session=[A-Za-z0-9_-]{43}$/);
    const bootstrap = await call('/api/account', cookie);
    expect(bootstrap.status).toBe(200);
    const account = await bootstrap.json() as { scope: typeof scope; session: { accountId: string } };
    expect(account.scope).toEqual(scope);
    return { cookie: cookie!, id: account.session.accountId };
  }
  const alice = await signup('alice');
  const bob = await signup('bob');
  expect(alice.id).not.toBe(bob.id);
  for (const [name, account] of [['alice', alice], ['bob', bob]] as const) {
    expect((await call('/api/profiles/james', account.cookie, 'PUT', { name, markdown: `${name}-private-profile`, accountId: 'attacker' })).status).toBe(200);
    expect(await (await call('/api/profiles/james', account.cookie)).json()).toMatchObject({ markdown: `${name}-private-profile` });
  }
  const answer = await call('/api/answer', alice.cookie, 'POST', { question: 'Tell me about this candidate', profileId: 'james', force: true });
  expect(answer.status).toBe(200);
  await answer.text();
  expect(answers).toHaveLength(1);
  expect(answers[0]).toContain('alice-private-profile');
  expect(answers[0]).not.toContain('bob-private-profile');
  expect(answers[0]).not.toContain('legacy-owner-profile');
  expect((await call('/api/auth/signout', alice.cookie, 'POST', {})).status).toBe(200);
  expect((await call('/api/profiles/james', alice.cookie)).status).toBe(401);
  expect((await call('/api/profiles/james', bob.cookie)).status).toBe(200);
  const signedInAgain = await signup('alice');
  expect(signedInAgain.id).toBe(alice.id);
  const deletion = await call('/api/account/delete', signedInAgain.cookie, 'POST', { confirm: true });
  expect(deletion.status).toBe(202);
  const ticket = deletion.headers.getSetCookie().find(value => value.startsWith('__Host-eugnel_delete='))?.split(';')[0];
  expect(ticket).toMatch(/^__Host-eugnel_delete=[A-Za-z0-9_-]{43}$/);
  expect((await call('/api/profiles/james', signedInAgain.cookie)).status).toBe(401);
  expect((await call('/api/account/delete/advance', ticket, 'POST', {})).status).toBe(200);
  expect(await identityRows(alice.id)).toHaveLength(1);
  expect(await profileRows(alice.id)).toHaveLength(1);
  refuseErasure = false;
  for (let attempt = 0; attempt < 5; attempt++) await call('/api/account/delete/advance', ticket, 'POST', {});
  // Product acknowledgement is real and already committed; a pending final
  // state now identifies the shared identity completion SQL, not a failed MAC.
  expect(await profileRows(alice.id)).toHaveLength(0);
  expect(reverse.length).toBeGreaterThanOrEqual(2);
  expect(reverse.every(value => value.accountId === alice.id && value.identityPresent && value.fenced)).toBe(true);
  const status = await call('/api/account/delete/status', ticket);
  expect(status.status).toBe(200);
  expect(await status.json()).toMatchObject({ state: 'completed', phase: 'completed' });
  expect(await identityRows(alice.id)).toHaveLength(0);
  expect(await profileRows(alice.id)).toHaveLength(0);
  expect(await identityRows(bob.id)).toHaveLength(1);
  expect(await profileRows(bob.id)).toHaveLength(1);
  expect((await call('/api/profiles/james', bob.cookie)).status).toBe(200);
  expect((await productDb.prepare('SELECT account_id FROM account_profile_fences WHERE account_id=?1').bind(alice.id).all()).results).toHaveLength(1);
  expect(kvRead).not.toHaveBeenCalled();
  expect(kvWrite).not.toHaveBeenCalled();
  expect(reports).toEqual([]);
}, 30_000);
