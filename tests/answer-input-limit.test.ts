import { expect, it, vi } from 'vitest';
import { handleAnswer, type AnswerBody } from '../worker/src/answer';
import { mockEnv } from './helpers';

const INPUT_BYTES = 256 * 1024;
function request(body: AnswerBody) {
  return new Request('https://rtt.eugnel.com/api/answer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
async function run(body: AnswerBody) {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
    'data: {"candidates":[{"content":{"parts":[{"text":"Complete."}]},"finishReason":"STOP"}]}\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  ));
  const getProfile = vi.fn(async () => ({ name: 'James', markdown: 'Separately bounded profile.' }));
  const response = await handleAnswer(request(body), mockEnv({ GEMINI_API_KEY: 'test-key' }), fetcher as any, {
    get: getProfile,
  } as any);
  return { response, fetcher, getProfile };
}

it('rejects oversized answer input before loading a profile or calling the provider', async () => {
  const { response, fetcher, getProfile } = await run({
    conversation: 'a'.repeat(INPUT_BYTES + 1), extractQuestion: true, profileId: 'james',
  });
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ error: expect.stringMatching(/input|large|limit/i) });
  expect(getProfile).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it('accepts exactly 256 KiB and forwards the entire transcript without truncation', async () => {
  const text = 'a'.repeat(INPUT_BYTES);
  const { response, fetcher } = await run({ conversation: text, extractQuestion: true });
  expect(response.status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const payload = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(payload.contents[0].parts[0].text).toBe(
    'Recent transcript (include the full latest question; never truncate):\n' + text,
  );
  await response.text();
});

it('measures UTF-8 bytes rather than JavaScript string length', async () => {
  const { response, fetcher, getProfile } = await run({
    conversation: '🙂'.repeat(INPUT_BYTES / 4 + 1), extractQuestion: true, profileId: 'james',
  });
  expect(response.status).toBe(413);
  expect(fetcher).not.toHaveBeenCalled();
  expect(getProfile).not.toHaveBeenCalled();
});

it('accepts a multibyte transcript exactly at the UTF-8 byte boundary', async () => {
  const text = 'é'.repeat(INPUT_BYTES / 2);
  const { response, fetcher } = await run({ conversation: text, extractQuestion: true });
  expect(response.status).toBe(200);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).contents[0].parts[0].text).toContain(text);
  await response.text();
});

it.each(['question', 'questionHint', 'previousQuestion', 'userContext', 'extraNotes', 'cvBackground'] as const)(
  'counts %s together with conversation before any downstream side effects', async (field) => {
    const { response, fetcher, getProfile } = await run({
      conversation: 'a'.repeat(INPUT_BYTES - 10), [field]: 'b'.repeat(11),
      extractQuestion: true, force: true, profileId: 'james',
    });
    expect(response.status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
    expect(getProfile).not.toHaveBeenCalled();
  },
);

it('aggregates all supplied note fields even when extraNotes supersedes legacy cvBackground', async () => {
  const { response, fetcher, getProfile } = await run({
    conversation: 'a'.repeat(80_000), userContext: 'u'.repeat(50_000),
    extraNotes: 'n'.repeat(70_000), cvBackground: 'c'.repeat(70_000),
    extractQuestion: true, profileId: 'james',
  });
  expect(response.status).toBe(413);
  expect(fetcher).not.toHaveBeenCalled();
  expect(getProfile).not.toHaveBeenCalled();
});

it('accepts combined prompt fields exactly at the byte limit and keeps each active field intact', async () => {
  const prefix = { question: 'Q?', questionHint: 'Hint', previousQuestion: 'Previous', userContext: 'Context',
    extraNotes: 'Notes', cvBackground: 'Legacy' };
  const extraBytes = Object.values(prefix).reduce((sum, text) => sum + new TextEncoder().encode(text).byteLength, 0);
  const conversation = 'a'.repeat(INPUT_BYTES - extraBytes);
  const { response, fetcher } = await run({ ...prefix, conversation, force: true });
  expect(response.status).toBe(200);
  const payload = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(payload.contents[0].parts[0].text).toBe('Question:\nQ?\n\nRecent transcript:\n' + conversation);
  expect(JSON.stringify(payload.systemInstruction.parts)).toContain('Context');
  expect(JSON.stringify(payload.systemInstruction.parts)).toContain('Notes');
  await response.text();
});
