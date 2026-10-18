import { afterEach, expect, it, vi } from 'vitest';
import { handleAnswer } from '../worker/src/answer';
import { mockEnv, mockFetch } from './helpers';

afterEach(() => vi.restoreAllMocks());

it.each(['provider error', 'prompt block', 'finish reason', 'reader rejection'])('does not echo private content from a stream %s', async (mode) => {
  const marker = 'synthetic-private-stream-provider-content';
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const payload = mode === 'provider error' ? { error: { message: marker, status: marker } }
    : mode === 'prompt block' ? { promptFeedback: { blockReason: marker } }
      : { candidates: [{ finishReason: marker }] };
  const stream = mode === 'reader rejection'
    ? new ReadableStream<Uint8Array>({ pull() { throw new Error(marker); } })
    : `data: ${JSON.stringify(payload)}\n\n`;
  const response = await handleAnswer(new Request('https://rtt.eugnel.com/api/answer', {
    method: 'POST', body: JSON.stringify({ question: 'Why?', force: true }),
  }), mockEnv({ GEMINI_API_KEY: 'test-key' }), mockFetch(() => new Response(stream)));
  const text = await response.text();
  expect(text).toContain('event: error');
  expect(text).not.toContain('event: done');
  expect(text).not.toContain(marker);
  expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
});
