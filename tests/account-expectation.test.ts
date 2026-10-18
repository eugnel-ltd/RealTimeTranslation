import { afterEach, expect, it, vi } from 'vitest';
import { createStorageScope } from '../client/src/services/browserStorage';
import { createAppRuntime } from '../client/src/services/accountLifetime';
import { fetchSpeechToken, translateText, detectQuestion, listProfiles, getProfile, putProfile, streamAnswer } from '../client/src/services/api';
import { AccountBrowser } from '../client/src/services/accountBrowser';
import { GeminiSpeechService } from '../client/src/services/geminiSpeech';
import { flush } from './account-harness';

const origin = 'https://rtt.example.test';
const enabled = (accountId: string | null) => ({
  enabled: true, scope: { productId: 'rtt', environment: 'preview', origin },
  session: accountId ? { accountId, authenticatedAt: '2026-10-18T01:00:00Z', expiresAt: '2099-10-18T12:00:00Z' } : null,
  ways: [], capabilities: { email: true, google: true, apple: true, siteKey: 'public-site' },
});
const runtime = () => createAppRuntime(createStorageScope({ ...enabled(null).scope, accountId: 'account_A' }), true, () => undefined);
afterEach(() => vi.unstubAllGlobals());

it('every personal HTTP consumer sends the immutable verified account consistency precondition', async () => {
  const calls: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_path: string, init?: RequestInit) => { calls.push(init ?? {}); return Response.json({}); }));
  const scope = runtime();
  await Promise.all([
    fetchSpeechToken(scope), translateText('private', ['en'], undefined, undefined, scope),
    detectQuestion({ segments: [], windowSeconds: 120, lastAnsweredQuestion: null, threshold: 0.5 }, scope),
    listProfiles(scope), getProfile('james', scope), putProfile('james', { markdown: 'Private' }, scope),
    streamAnswer({ conversation: 'private', answerLanguage: 'en', model: 'gemini-3.8-flash', userContext: '' }, () => undefined, undefined, scope),
  ]);
  expect(calls).toHaveLength(7);
  for (const init of calls) expect(new Headers(init.headers).get('Eugnel-Expected-Account'), 'personal requests must never run under an unverified changed cookie').toBe('account:account_A');
  scope.revoke();
});

it.each(['delete', 'signout', 'start', 'verify', 'cancel'])('captures the displayed account for the %s auth control precondition', async (kind) => {
  const controls: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    if (input === '/api/account') return Response.json(enabled('account_A'));
    controls.push(init ?? {}); return Response.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }));
  const browser = new AccountBrowser(origin); await browser.refresh();
  try {
    if (kind === 'delete') await browser.deleteAccount();
    if (kind === 'signout') await browser.signout();
    if (kind === 'start') await browser.startEmail('a@example.test', 'fixture').catch(() => undefined);
    if (kind === 'verify') await browser.verifyEmail('a@example.test', '111111').catch(() => undefined);
    if (kind === 'cancel') await browser.cancelGoogle().catch(() => undefined);
    expect(new Headers(controls[0]?.headers).get('Eugnel-Expected-Account')).toBe('account:account_A');
  } finally { browser.dispose(); }
});

it('uses a disjoint signed-out expectation and encodes OAuth starts without identity tokens', async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === '/api/account') return Response.json(enabled(null));
    if (path.endsWith('/status')) return Response.json({ error: 'DELETE_TICKET_INVALID' }, { status: 401 });
    return Response.json({ ok: true });
  }));
  const assign = vi.fn(); vi.stubGlobal('window', { location: { assign } });
  const browser = new AccountBrowser(origin); await browser.refresh();
  try {
    await browser.startEmail('a@example.test', 'fixture');
    const call = calls.find((entry) => entry.path === '/api/auth/email/start');
    expect(new Headers(call?.init?.headers).get('Eugnel-Expected-Account')).toBe('signed-out');
    browser.oauth('google');
    const url = new URL(assign.mock.calls[0][0] as string, origin);
    expect(url.pathname).toBe('/api/auth/google/start'); expect(url.searchParams.get('expectedAccount')).toBe('signed-out');
    expect([...url.searchParams.keys()]).toEqual(['expectedAccount']);
  } finally { browser.dispose(); }
});

it('keeps native same-origin Gemini proxy sockets bound to the verified account', async () => {
  const urls: string[] = [];
  vi.stubGlobal('window', { location: { protocol: 'https:', host: 'rtt.example.test' } });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ proxyUrl: '/api/gemini-live?mode=transcribe' })));
  vi.stubGlobal('WebSocket', class {
    readyState = 0;
    constructor(url: string) { urls.push(url); }
    close() {} send() {}
  });
  const lifetime = runtime();
  const service = new GeminiSpeechService({ onRecognizing() {}, onRecognized() {}, onError() {} }, lifetime);
  const starting = service.start({ inputLanguage: 'en-US', outputLanguage: 'en' }, 'transcribe');
  await flush(); await service.stop(); await starting;
  expect(urls).toHaveLength(1);
  expect(new URL(urls[0]).searchParams.get('expectedAccount')).toBe('account:account_A');
  lifetime.revoke();
});
