import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { resetAccessJwksCache } from '../worker/src/access';
import { resetJevCooldown } from '../worker/src/detect-question';
import { mockEnv, mockKv } from './helpers';

const origin = 'https://rtt.example.test';
const issuer = 'https://api-origin-access.example.test';
const audience = 'api-mutation-origin';
let assertion: string;
let keys: Awaited<ReturnType<typeof exportJWK>>[];
type Mutation = { path: string; method: 'POST' | 'PUT'; body: Record<string, unknown>; profile?: boolean };
const mutations: Mutation[] = [
  { path: '/api/translate', method: 'POST', body: { text: 'Synthetic text', to: ['en'] } },
  { path: '/api/gemini-token', method: 'POST', body: { mode: 'transcribe' } },
  { path: '/api/detect-question', method: 'POST', body: { segments: [{ index: 0, text: 'What is your experience?' }] } },
  { path: '/api/answer', method: 'POST', body: { question: 'What is your experience?' } },
  { path: '/api/profiles/james', method: 'PUT', body: { markdown: 'Replacement profile' }, profile: true },
];
beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  keys = [{ ...await exportJWK(pair.publicKey), kid: 'api-origin-local', alg: 'RS256', use: 'sig' }];
  assertion = await new SignJWT({ sub: 'synthetic-owner' })
    .setProtectedHeader({ alg: 'RS256', kid: 'api-origin-local' })
    .setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
});
beforeEach(() => { resetAccessJwksCache(); resetJevCooldown(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup() {
  const kv = mockKv({ 'profile:james': { value: 'Original owner profile' } });
  const put = vi.spyOn(kv, 'put');
  let providerRequests = 0, accessRequests = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `${issuer}/cdn-cgi/access/certs`) { accessRequests++; return Response.json({ keys }); }
    providerRequests++;
    if (url.startsWith('https://api.cognitive.microsofttranslator.com/translate')) {
      return Response.json([{ translations: [{ to: 'en', text: 'Translated fixture' }] }]);
    }
    if (url === 'https://generativelanguage.googleapis.com/v1beta/auth_tokens') return Response.json({ name: 'local' });
    if (url.includes(':streamGenerateContent')) {
      return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Answer fixture' }] }, finishReason: 'STOP' }] })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (url.startsWith('https://generativelanguage.googleapis.com/') && url.includes(':generateContent')) {
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ question: null, is_new: false }) }] } }] });
    }
    throw new Error('Unexpected destination in injected local regression');
  }));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return { kv, put, providerRequests: () => providerRequests, accessRequests: () => accessRequests,
    env: mockEnv({ PROFILES: kv, AZURE_TRANSLATOR_KEY: 'tkey', GEMINI_API_KEY: 'gkey',
      SKIP_ACCESS_CHECK: 'false', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: audience }) };
}
function request(mutation: Mutation, suppliedOrigin: string | null, extras: Record<string, string> = {}, target = origin) {
  const headers = new Headers({ 'Cf-Access-Jwt-Assertion': assertion, 'Content-Type': 'text/plain', ...extras });
  if (suppliedOrigin !== null) headers.set('Origin', suppliedOrigin);
  return new Request(`${target}${mutation.path}`, { method: mutation.method, headers, body: JSON.stringify(mutation.body) });
}
for (const mutation of mutations) {
  it.each(['https://sibling.example.test', 'null', `${origin}, ${origin}`])(
    `${mutation.method} ${mutation.path} rejects explicit Origin %j before body/provider/write`, async value => {
      const h = setup(), incoming = request(mutation, value), readBody = vi.spyOn(incoming, 'json');
      const response = await worker.fetch(incoming, h.env);
      expect(response.status, 'verified Access must not authorize a foreign mutation Origin').toBe(403);
      expect(h.accessRequests()).toBe(1);
      expect(readBody).not.toHaveBeenCalled();
      expect(h.providerRequests()).toBe(0); expect(h.put).not.toHaveBeenCalled();
      expect(await h.kv.get('profile:james')).toBe('Original owner profile');
    });
  it.each([null, origin])(`${mutation.method} ${mutation.path} preserves Origin %j and existing JSON/text compatibility`, async value => {
    const h = setup();
    const response = await worker.fetch(request(mutation, value), h.env);
    expect(response.status).toBe(200); await response.text();
    expect(h.accessRequests()).toBe(1);
    expect(h.providerRequests()).toBe(mutation.profile ? 0 : 1);
    expect(h.put).toHaveBeenCalledTimes(mutation.profile ? 1 : 0);
  });
}
it.each(['', 'malformed', `${origin}/`, `${origin}/path`, 'http://rtt.example.test', `${origin}:444`])(
  'rejects noncanonical explicit Origin %j before reading JSON', async value => {
    const h = setup(), incoming = request(mutations[0], value), readBody = vi.spyOn(incoming, 'json');
    expect((await worker.fetch(incoming, h.env)).status).toBe(403);
    expect(readBody).not.toHaveBeenCalled(); expect(h.providerRequests()).toBe(0);
  });
it('rejects duplicate Origins and does not trust forwarded host metadata', async () => {
  const h = setup(), incoming = request(mutations[4], origin, { 'X-Forwarded-Host': 'sibling.example.test' });
  incoming.headers.append('Origin', 'https://sibling.example.test');
  expect((await worker.fetch(incoming, h.env)).status).toBe(403);
  expect(h.put).not.toHaveBeenCalled(); expect(h.providerRequests()).toBe(0);
});
it('does not authorize a sibling Origin from matching forwarded host headers', async () => {
  const h = setup();
  const incoming = request(mutations[0], 'https://sibling.example.test', {
    'X-Forwarded-Host': 'sibling.example.test', 'X-Forwarded-Proto': 'https',
    Forwarded: 'host=sibling.example.test;proto=https',
  });
  expect((await worker.fetch(incoming, h.env)).status).toBe(403);
  expect(h.providerRequests()).toBe(0); expect(h.put).not.toHaveBeenCalled();
});
it('uses the canonical request URL for an allowed nondefault port', async () => {
  const h = setup(), target = `${origin}:444`;
  expect((await worker.fetch(request(mutations[4], target, {}, target), h.env)).status).toBe(200);
  expect(h.put).toHaveBeenCalledTimes(1);
});
it('keeps missing-Access refusal first', async () => {
  const h = setup(), incoming = request(mutations[0], 'https://sibling.example.test');
  incoming.headers.delete('Cf-Access-Jwt-Assertion');
  const response = await worker.fetch(incoming, h.env);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'Missing Cf-Access-Jwt-Assertion' });
  expect(h.accessRequests()).toBe(0); expect(h.providerRequests()).toBe(0); expect(h.put).not.toHaveBeenCalled();
});
it.each(['GET', 'HEAD'])('does not apply mutation-origin handling to %s', async method => {
  const h = setup();
  const response = await worker.fetch(new Request(`${origin}/api/health`, {
    method, headers: { 'Cf-Access-Jwt-Assertion': assertion, Origin: 'https://sibling.example.test' },
  }), h.env);
  expect(response.status).toBe(method === 'GET' ? 200 : 404);
  expect(h.accessRequests()).toBe(1); expect(h.providerRequests()).toBe(0);
});
