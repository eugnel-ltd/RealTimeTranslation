import { afterEach, expect, it, vi } from 'vitest';
import { translateText } from '../client/src/services/api';
import { handleTranslate } from '../worker/src/translate';
import { mockEnv, mockFetch } from './helpers';

afterEach(() => vi.restoreAllMocks());

it('passes translation cancellation from the browser to its fetch', async () => {
  const controller = new AbortController();
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"translations":["hello"],"provider":"gemini"}'));
  await translateText('hello', ['en'], undefined, controller.signal);
  expect(request.mock.calls[0][1]?.signal).toBe(controller.signal);
});

it('passes the incoming translation cancellation signal to the provider', async () => {
  const controller = new AbortController();
  const request = new Request('https://rtt.eugnel.com/api/translate', {
    method: 'POST', body: JSON.stringify({ text: 'hello', to: ['en'] }), signal: controller.signal,
  });
  let signal: AbortSignal | null | undefined;
  await handleTranslate(request, mockEnv({ GEMINI_API_KEY: 'test-key' }), mockFetch((_url, init) => {
    signal = init?.signal;
    return new Response('{"candidates":[{"content":{"parts":[{"text":"{\\"translations\\":[{\\"to\\":\\"en\\",\\"text\\":\\"hello\\"}]}"}]}}]}');
  }));
  expect(signal).toBe(request.signal);
});
