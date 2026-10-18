import { afterEach, expect, it, vi } from 'vitest';
import { createStorageScope } from '../client/src/services/browserStorage';
import { createAppRuntime } from '../client/src/services/accountLifetime';
import { apiJson, fetchSpeechToken, translateText, detectQuestion, listProfiles, streamAnswer } from '../client/src/services/api';
import { GeminiSpeechService } from '../client/src/services/geminiSpeech';
import { deferred } from './account-harness';

function runtime() {
  return createAppRuntime(createStorageScope({ productId: 'rtt', environment: 'preview', origin: 'https://rtt.example.test', accountId: 'account_A' }), true, vi.fn());
}
afterEach(() => vi.unstubAllGlobals());

it('aborts every scoped HTTP consumer and refuses late response bodies', async () => {
  const lifetime = runtime(); const pending = deferred<Response>(); const signals: Array<AbortSignal | null | undefined> = [];
  vi.stubGlobal('fetch', vi.fn((_path: string, init?: RequestInit) => { signals.push(init?.signal); return pending.promise; }));
  const work = [
    fetchSpeechToken(lifetime), translateText('private', ['en'], 'en-US', undefined, lifetime),
    detectQuestion({ segments: [], windowSeconds: 120, lastAnsweredQuestion: null, threshold: 0.5 }, lifetime), listProfiles(lifetime),
  ];
  lifetime.revoke();
  expect(signals).toHaveLength(4); expect(signals.every((signal) => signal?.aborted)).toBe(true);
  pending.resolve(Response.json({ token: 'test' }));
  for (const result of await Promise.allSettled(work)) expect(result.status).toBe('rejected');
});

it('invalidates by actual paid-route 401 status and never accepts its body as account data', async () => {
  const changed = vi.fn(); const lifetime = createAppRuntime(createStorageScope({ productId: 'rtt', environment: 'preview', origin: 'https://rtt.example.test', accountId: 'account_A' }), true, changed);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Sign in required' }, { status: 401 })));
  await expect(apiJson('/api/config', undefined, lifetime)).rejects.toHaveProperty('name', 'AbortError');
  expect(lifetime.active).toBe(false); expect(changed).toHaveBeenCalledOnce();
});

it('does not open Gemini proxy fallback after a revoked-account token rejection', async () => {
  const lifetime = runtime(); const sockets = vi.fn();
  vi.stubGlobal('WebSocket', sockets);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Sign in required' }, { status: 401 })));
  const service = new GeminiSpeechService({ onRecognizing() {}, onRecognized() {}, onError() {} }, lifetime);
  await service.start({ inputLanguage: 'en-US', outputLanguage: 'en' }, 'transcribe');
  expect(lifetime.active).toBe(false); expect(sockets).not.toHaveBeenCalled();
  await service.stop();
});

it('cancels a real streaming reader and rejects events after lifetime revocation', async () => {
  const lifetime = runtime(); let source!: ReadableStreamDefaultController<Uint8Array>; const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; }, cancel: cancelled });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
  const event = vi.fn();
  const pending = streamAnswer({ conversation: 'Private', answerLanguage: 'en', userContext: '', model: 'gemini-3.8-flash' }, event, undefined, lifetime);
  await Promise.resolve(); await Promise.resolve();
  lifetime.revoke();
  try { source.enqueue(new TextEncoder().encode('event: token\ndata: {"text":"late"}\n\n')); } catch { /* A closed reader is also the required outcome. */ }
  await pending;
  expect(cancelled).toHaveBeenCalled(); expect(event).not.toHaveBeenCalled();
});
