import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { mockEnv, mockKv } from './helpers';

afterEach(() => vi.restoreAllMocks());

const routes = [
  ['/api/translate', 'POST'], ['/api/answer', 'POST'],
  ['/api/detect-question', 'POST'], ['/api/gemini-token', 'POST'],
  ['/api/profiles/james', 'PUT'],
] as const;

function request(path: string, method: string, body: string): Request {
  return new Request(`https://rtt.eugnel.com${path}`, { method, body });
}

function guardedEnv() {
  const kv = mockKv();
  const put = vi.spyOn(kv, 'put');
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider must not run'));
  return { env: mockEnv({ GEMINI_API_KEY: 'test-key', TYPESAFE_API_KEY: 'test-key', PROFILES: kv }), put, fetchSpy };
}

describe('API JSON request boundaries', () => {
  it.each(routes)('rejects malformed JSON and non-object bodies at %s', async (path, method) => {
    const { env, put, fetchSpy } = guardedEnv();
    for (const body of ['{invalid-secret-value', 'null', '[]', '1', '"text"']) {
      const response = await worker.fetch(request(path, method, body), env);
      expect(response.status, `${path}: ${body}`).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/json');
      const text = await response.text();
      expect(text.length).toBeLessThan(160);
      expect(text).not.toContain('invalid-secret-value');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it.each([
    ['/api/translate', 'POST', { text: 12, to: ['en'] }],
    ['/api/translate', 'POST', { text: 'hello', to: [null] }],
    ['/api/translate', 'POST', { text: 'hello', to: 'en' }],
    ['/api/translate', 'POST', { text: 'hello', to: ['en'], from: {} }],
    ['/api/answer', 'POST', { question: 'Why?', conversation: [] }],
    ['/api/answer', 'POST', { question: 'Why?', profileId: 12 }],
    ['/api/answer', 'POST', { question: 'Why?', userContext: {} }],
    ['/api/answer', 'POST', { question: 'Why?', force: 'false' }],
    ['/api/answer', 'POST', { question: 'Why?', answerLanguage: 'invalid' }],
    ['/api/answer', 'POST', { question: 'Why?', questionTimeLimitSeconds: '60' }],
    ['/api/detect-question', 'POST', { segments: {} }],
    ['/api/detect-question', 'POST', { segments: [null] }],
    ['/api/detect-question', 'POST', { segments: [{ text: 12, index: 0 }] }],
    ['/api/detect-question', 'POST', { segments: [{ text: 'Why?', index: '0' }] }],
    ['/api/detect-question', 'POST', { segments: [{ text: 'Why?', index: 0, timestamp: 12 }] }],
    ['/api/detect-question', 'POST', { threshold: '0.6' }],
    ['/api/detect-question', 'POST', { mode: 'unexpected' }],
    ['/api/gemini-token', 'POST', { mode: {} }],
    ['/api/gemini-token', 'POST', { targetLanguage: [] }],
    ['/api/profiles/james', 'PUT', { markdown: 12 }],
    ['/api/profiles/james', 'PUT', { markdown: 'keep profile', name: {} }],
  ])('rejects invalid supplied fields at %s: %j', async (path, method, body) => {
    const { env, put, fetchSpy } = guardedEnv();
    const response = await worker.fetch(request(String(path), String(method), JSON.stringify(body)), env);
    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it.each(routes)('checks Access before reading JSON at %s', async (path, method) => {
    const req = request(path, method, '{');
    const read = vi.spyOn(req, 'json');
    const response = await worker.fetch(req, mockEnv({ SKIP_ACCESS_CHECK: 'false' }));
    expect(response.status).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });
});

it.each([
  ['/api/translate', 'POST', { text: 'hello', to: ['en'] }],
  ['/api/answer', 'POST', { question: 'Why?', force: true }],
  ['/api/gemini-token', 'POST', {}],
  ['/api/speech-token', 'GET', undefined],
])('does not expose provider error bodies for %s', async (path, method, body) => {
  const marker = 'synthetic-private-provider-key-and-transcript';
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(marker, { status: 401 }));
  const req = new Request(`https://rtt.eugnel.com${path}`, {
    method: String(method), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await worker.fetch(req, mockEnv({ GEMINI_API_KEY: 'test-key', AZURE_SPEECH_KEY: 'test-key' }));
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain(marker);
  expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
});
