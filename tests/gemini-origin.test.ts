import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { resetAccessJwksCache } from '../worker/src/access';
import { handleGeminiLiveProxy, type WsPeer } from '../worker/src/gemini';
import { mockEnv } from './helpers';

const origin = 'https://rtt.example.test';
const issuer = 'https://websocket-access.example.test';
const audience = 'websocket-origin-test';
let assertion: string;
let keys: Awaited<ReturnType<typeof exportJWK>>[];
let pairs: number;
let providerRequests: number;
let keyRequests: number;

class Peer extends EventTarget implements WsPeer {
  accept() { /* Local handshake fixture. */ }
  send() { /* No audio or provider frames are sent. */ }
  close() { /* No external socket exists. */ }
}
const NativeResponse = globalThis.Response;
class UpgradeResponse extends NativeResponse {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(init?.status === 101 ? null : body, init?.status === 101 ? { status: 200 } : init);
    if (init?.status === 101) {
      Object.defineProperty(this, 'status', { value: 101 });
      Object.defineProperty(this, 'webSocket', { value: init.webSocket });
    }
  }
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  keys = [{ ...await exportJWK(pair.publicKey), kid: 'websocket-local-key', alg: 'RS256', use: 'sig' }];
  assertion = await new SignJWT({ sub: 'synthetic-access-user' })
    .setProtectedHeader({ alg: 'RS256', kid: 'websocket-local-key' })
    .setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
});
beforeEach(() => {
  pairs = 0; providerRequests = 0; keyRequests = 0;
  resetAccessJwksCache();
  vi.stubGlobal('Response', UpgradeResponse);
  vi.stubGlobal('WebSocketPair', class {
    0 = new Peer();
    1 = new Peer();
    constructor() { pairs++; }
  });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === `${issuer}/cdn-cgi/access/certs`) {
      keyRequests++;
      return NativeResponse.json({ keys });
    }
    if (String(input).startsWith('https://generativelanguage.googleapis.com/ws/')) {
      providerRequests++;
      return { webSocket: new Peer() } as unknown as Response;
    }
    throw new Error('Unexpected external destination in local regression');
  }));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function request(suppliedOrigin: string | null, extra: Record<string, string> = {}, url = origin) {
  const headers = new Headers({ Upgrade: 'websocket', ...extra });
  if (suppliedOrigin !== null) headers.set('Origin', suppliedOrigin);
  return new Request(`${url}/api/gemini-live`, { headers });
}
const configuration = () => mockEnv({ GEMINI_API_KEY: 'gkey' });

it.each([
  'https://sibling.example.test', 'https://other.invalid', 'http://rtt.example.test',
  'https://rtt.example.test:444', 'null', '', 'malformed',
  'https://rtt.example.test/', 'https://rtt.example.test/path',
  'https://rtt.example.test?query=value', 'https://user@rtt.example.test',
  'https://rtt.example.test https://sibling.example.test',
  'https://rtt.example.test, https://rtt.example.test',
])('rejects explicit origin %j before allocating a pair or opening paid upstream', async value => {
  const response = await handleGeminiLiveProxy(request(value), configuration());
  expect(response.status, 'an explicit origin must exactly match the request URL origin').toBe(403);
  expect(pairs, 'rejected origins must not allocate local WebSockets').toBe(0);
  expect(providerRequests, 'rejected origins must not open the paid upstream').toBe(0);
});

it('rejects coalesced duplicate Origin headers before allocating sockets', async () => {
  const incoming = request(origin);
  incoming.headers.append('Origin', origin);
  const response = await handleGeminiLiveProxy(incoming, configuration());
  expect(response.status).toBe(403);
  expect(pairs).toBe(0); expect(providerRequests).toBe(0);
});

it('uses the request URL rather than spoofed forwarding headers as origin authority', async () => {
  const response = await handleGeminiLiveProxy(request('https://sibling.example.test', {
    'X-Forwarded-Host': 'sibling.example.test', 'X-Forwarded-Proto': 'https',
    Forwarded: 'host=sibling.example.test;proto=https',
  }), configuration());
  expect(response.status).toBe(403);
  expect(pairs).toBe(0); expect(providerRequests).toBe(0);
});

it.each([null, origin])('preserves a legitimate handshake with Origin %j', async value => {
  expect((await handleGeminiLiveProxy(request(value), configuration())).status).toBe(101);
  expect(pairs).toBe(1); expect(providerRequests).toBe(1);
});
it('accepts the exact canonical origin of a request with a nondefault port', async () => {
  const target = 'https://rtt.example.test:444';
  expect((await handleGeminiLiveProxy(request(target, {}, target), configuration())).status).toBe(101);
  expect(pairs).toBe(1); expect(providerRequests).toBe(1);
});

it('refuses a foreign browser origin through the actual router after real Access verification', async () => {
  const response = await worker.fetch(request('https://sibling.example.test', {
    'Cf-Access-Jwt-Assertion': assertion, Cookie: `__Host-eugnel_session=${'s'.repeat(43)}`,
  }), mockEnv({ GEMINI_API_KEY: 'gkey', SKIP_ACCESS_CHECK: 'false', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: audience }));
  expect(keyRequests, 'the local signed Access assertion must be verified first').toBe(1);
  expect(response.status, 'a verified Access session must not authorize another browser origin').toBe(403);
  expect(pairs).toBe(0); expect(providerRequests).toBe(0);
});
it.each([null, origin])('preserves router Access verification for an allowed Origin %j', async value => {
  const response = await worker.fetch(request(value, { 'Cf-Access-Jwt-Assertion': assertion }),
    mockEnv({ GEMINI_API_KEY: 'gkey', SKIP_ACCESS_CHECK: 'false', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: audience }));
  expect(response.status).toBe(101);
  expect(keyRequests).toBe(1); expect(pairs).toBe(1); expect(providerRequests).toBe(1);
});
it('still checks Access before origin handling when the assertion is missing', async () => {
  const response = await worker.fetch(request('https://sibling.example.test'),
    mockEnv({ GEMINI_API_KEY: 'gkey', SKIP_ACCESS_CHECK: 'false', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: audience }));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'Missing Cf-Access-Jwt-Assertion' });
  expect(keyRequests).toBe(0); expect(pairs).toBe(0); expect(providerRequests).toBe(0);
});
