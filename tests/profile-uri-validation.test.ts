import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { resetAccessJwksCache } from '../worker/src/access';
import { jsonResponse, mockEnv, mockKv } from './helpers';

const issuer = 'https://rtt-access.test.invalid';
const audience = 'profile-uri-test';
let token: string;
let keys: Awaited<ReturnType<typeof exportJWK>>[];

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  keys = [{ ...await exportJWK(pair.publicKey), kid: 'synthetic-profile-uri', alg: 'RS256', use: 'sig' }];
  token = await new SignJWT({ sub: 'synthetic-profile-user' })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-profile-uri' })
    .setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
});

beforeEach(() => resetAccessJwksCache());
afterEach(() => vi.restoreAllMocks());

function setup() {
  const kv = mockKv({ 'profile:james': { value: 'Synthetic profile', metadata: { name: 'Synthetic candidate' } } });
  const operations = [vi.spyOn(kv, 'get'), vi.spyOn(kv, 'getWithMetadata'), vi.spyOn(kv, 'put'), vi.spyOn(kv, 'list'), vi.spyOn(kv, 'delete')];
  const tasks: Promise<unknown>[] = [];
  const waitUntil = vi.fn((task: Promise<unknown>) => { tasks.push(task); });
  const ctx = { waitUntil } as unknown as ExecutionContext;
  const configuration = mockEnv({
    SKIP_ACCESS_CHECK: 'false', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: audience, PROFILES: kv,
    SENTRY_DSN: `https://${'1'.repeat(32)}@rtt-sentry.test.invalid/12345`,
  });
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) === `${issuer}/cdn-cgi/access/certs`) return jsonResponse({ keys });
    throw new Error('No provider or reporting request is allowed');
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return { configuration, operations, tasks, ctx, waitUntil, fetchSpy, kv };
}

function request(id: string, method: 'GET' | 'PUT', authenticated = true) {
  return new Request(`https://rtt.eugnel.com/api/profiles/${id}`, {
    method,
    headers: authenticated ? { 'Cf-Access-Jwt-Assertion': token } : undefined,
    ...(method === 'PUT' ? { body: JSON.stringify({ markdown: 'Synthetic replacement' }) } : {}),
  });
}

describe('profile URI input boundary behind verified Access', () => {
  for (const method of ['GET', 'PUT'] as const) {
    it.each(['%', '%ZZ', '%FF', '%E0%A4%A', '%C0%AF'])(`${method} rejects malformed encoding %s as client input`, async (id) => {
      const h = setup();
      const response = await worker.fetch(request(id, method), h.configuration, h.ctx);
      await Promise.all(h.tasks);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid profile id encoding' });
      expect(h.operations.every(operation => operation.mock.calls.length === 0)).toBe(true);
      expect(h.waitUntil).not.toHaveBeenCalled();
      expect(h.fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([`${issuer}/cdn-cgi/access/certs`]);
    });

    it(`${method} still refuses a missing Access assertion before malformed ID handling`, async () => {
      const h = setup();
      const response = await worker.fetch(request('%FF', method, false), h.configuration, h.ctx);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Missing Cf-Access-Jwt-Assertion' });
      expect(h.operations.every(operation => operation.mock.calls.length === 0)).toBe(true);
      expect(h.waitUntil).not.toHaveBeenCalled();
      expect(h.fetchSpy).not.toHaveBeenCalled();
    });

    it(`${method} preserves valid percent-encoded supported IDs`, async () => {
      const h = setup();
      const response = await worker.fetch(request('%6Aames', method), h.configuration, h.ctx);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: 'james', markdown: method === 'GET' ? 'Synthetic profile' : 'Synthetic replacement' });
      expect(h.waitUntil).not.toHaveBeenCalled();
      expect(h.fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([`${issuer}/cdn-cgi/access/certs`]);
    });

    it(`${method} keeps a valid encoded unsupported ID at 404 without KV access`, async () => {
      const h = setup();
      const response = await worker.fetch(request('%E4%B8%AD', method), h.configuration, h.ctx);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Unknown profile id' });
      expect(h.operations.every(operation => operation.mock.calls.length === 0)).toBe(true);
      expect(h.waitUntil).not.toHaveBeenCalled();
      expect(h.fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([`${issuer}/cdn-cgi/access/certs`]);
    });
  }
});
