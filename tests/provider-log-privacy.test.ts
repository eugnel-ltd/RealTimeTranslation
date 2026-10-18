import { afterEach, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { handleDetectQuestion } from '../worker/src/detect-question';
import { handleGeminiLiveProxy } from '../worker/src/gemini';
import { mockEnv } from './helpers';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['router', 'detector', 'live proxy'])('keeps arbitrary provider rejection messages out of %s failure logs', async (path) => {
  const marker = 'synthetic-private-provider-rejection';
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(marker));
  const env = mockEnv({ GEMINI_API_KEY: 'test-key' });
  let response: Response;
  if (path === 'live proxy') {
    vi.stubGlobal('WebSocketPair', class {
      0 = {};
      1 = { accept() {}, close() {} };
    });
    response = await handleGeminiLiveProxy(new Request('https://rtt.eugnel.com/api/gemini-live', { headers: { Upgrade: 'websocket' } }), env);
  } else if (path === 'detector') {
    response = await handleDetectQuestion(new Request('https://rtt.eugnel.com/api/detect-question', {
      method: 'POST', body: JSON.stringify({ segments: [{ index: 0, text: 'Why?' }] }),
    }), env);
  } else {
    response = await worker.fetch(new Request('https://rtt.eugnel.com/api/translate', {
      method: 'POST', body: JSON.stringify({ text: 'hello', to: ['en'] }),
    }), env);
  }
  expect(await response.text()).not.toContain(marker);
  expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
});
