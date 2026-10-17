import { describe, expect, it, vi } from 'vitest';
import { buildAnswerSystemBlocks, handleAnswer, shouldSkipAnswer, type AnswerBody } from '../worker/src/answer';
import { mockEnv, mockFetch, mockKv, textResponse } from './helpers';

function post(body: AnswerBody): Request {
  return new Request('https://rtt.eugnel.com/api/answer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function event(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function candidate(text: string, finishReason?: string): unknown {
  return { candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] };
}

function stream(text = 'ok', finishReason = 'STOP'): Response {
  return new Response(event(candidate(text, finishReason)), { headers: { 'Content-Type': 'text/event-stream' } });
}

async function readEvents(response: Response): Promise<Array<{ event: string; data: unknown }>> {
  return (await response.text()).trim().split('\n\n').map((chunk) => {
    const [name, data] = chunk.split('\n');
    return { event: name.slice(7), data: JSON.parse(data.slice(6)) };
  });
}

const env = () => mockEnv({ GEMINI_API_KEY: 'test-gemini-key' });

describe('answer', () => {
  it('skips duplicate questions unless forced', () => {
    expect(shouldSkipAnswer('What is your stack?', 'what is your  stack?', false)).toBe(true);
    expect(shouldSkipAnswer('What is your stack?', 'what is your  stack?', true)).toBe(false);
    expect(shouldSkipAnswer('Old', 'New question?', false)).toBe(false);
  });

  it('keeps static text, profile and context in a stable prefix order', () => {
    const blocks = buildAnswerSystemBlocks({
      knownQuestion: true,
      userContext: 'Staff interview at a Cloudflare shop', extraNotes: 'Emphasise incidents.',
      profileName: 'James', profileMarkdown: 'Staff engineer at Eugnel, 8 years TypeScript.',
    });
    expect(blocks).toHaveLength(3);
    expect(blocks[0].text).toContain('STAR');
    expect(blocks[0].text).toContain('spoken-style');
    expect(blocks[0].text).toContain('[team size]');
    expect(blocks[0].text).toContain('Do not refuse with hedges');
    expect(blocks[1]).toEqual({ type: 'text', text: 'Candidate profile (James):\nStaff engineer at Eugnel, 8 years TypeScript.' });
    expect(blocks[2].text).toContain('Staff interview at a Cloudflare shop');
    expect(blocks[2].text).toContain('Emphasise incidents.');
    expect(JSON.stringify(blocks)).not.toContain('cache_control');
  });

  it('shapes prompts per session template', () => {
    const prompt = (opts: Parameters<typeof buildAnswerSystemBlocks>[0]) =>
      buildAnswerSystemBlocks(opts).map((b) => b.text).join('\n');
    const screening = prompt({ knownQuestion: true, templateId: 'interview-screening' });
    expect(screening).toContain('screening');
    expect(screening).toContain('20–45 seconds');
    const timed = prompt({ knownQuestion: true, templateId: 'interview-ai-timed', questionTimeLimitSeconds: 60 });
    expect(timed).toContain('60 seconds');
    expect(timed).toContain('timed');
    const oneway = prompt({ knownQuestion: true, templateId: 'interview-oneway-video' });
    for (const word of ['HireVue', '250–330', 'keyword bullets', 'STAR']) expect(oneway).toContain(word);
    const meeting = prompt({ knownQuestion: false, extractQuestion: true, templateId: 'meeting' });
    expect(meeting).toContain('meeting copilot');
    expect(meeting).not.toContain('Speak as the candidate in a live interview');
    expect(meeting).toContain('Never truncate');
    expect(meeting).toContain('Action items');
  });

  it('omits an empty profile', () => {
    expect(buildAnswerSystemBlocks({ knownQuestion: true, profileMarkdown: '  ' })).toHaveLength(2);
  });

  it('sends the selected KV profile as a separate Gemini part after the static text', async () => {
    const kv = mockKv({ 'profile:james': { value: 'Staff engineer at Eugnel', metadata: { name: 'James' } } });
    const res = await handleAnswer(post({
      model: 'gemini-3.5-flash-lite', question: 'What is your greatest strength?',
      conversation: 'Recent speech', userContext: 'Interviewing for Staff', extraNotes: 'Emphasise incidents',
      profileId: 'james', force: true,
    }), mockEnv({ GEMINI_API_KEY: 'test-key', PROFILES: kv }), mockFetch((url, init) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-key');
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
      const body = JSON.parse(String(init?.body));
      expect(body.generationConfig).toEqual({ maxOutputTokens: 1024 + 2048, thinkingConfig: { thinkingLevel: 'minimal' } });
      expect(body.systemInstruction.parts).toHaveLength(3);
      expect(body.systemInstruction.parts[0].text).toContain('STAR');
      expect(body.systemInstruction.parts[1]).toEqual({ text: 'Candidate profile (James):\nStaff engineer at Eugnel' });
      expect(body.systemInstruction.parts[2].text).toContain('Emphasise incidents');
      expect(body.systemInstruction.parts[1].text).not.toContain('Emphasise incidents');
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Question:\nWhat is your greatest strength?\n\nRecent transcript:\nRecent speech' }] }]);
      expect(body).not.toHaveProperty('model');
      expect(JSON.stringify(body)).not.toContain('cache_control');
      return stream('I stay calm.');
    }));
    expect(await readEvents(res)).toEqual([
      { event: 'question', data: { question: 'What is your greatest strength?' } },
      { event: 'token', data: { text: 'I stay calm.' } }, { event: 'done', data: {} },
    ]);
  });

  it.each([
    [undefined, 'gemini-3.8-flash', 'gemini-3.8-flash'],
    ['unsupported-model', 'gemini-3.5-flash-lite', 'gemini-3.5-flash-lite'],
    ['unsupported-model', '', 'gemini-3.8-flash'],
    ['unsupported-model', 'unsupported-default', 'gemini-3.8-flash'],
    ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'],
  ])('selects an allowed model for request %s and default %s', async (model, fallback, expected) => {
    const res = await handleAnswer(post({ question: 'Hello?', model }),
      mockEnv({ GEMINI_API_KEY: 'test-key', DEFAULT_ANSWER_MODEL: fallback }), mockFetch((url) => {
        expect(url).toContain(`/models/${expected}:streamGenerateContent?alt=sse`);
        return stream();
      }));
    expect(await res.text()).toContain('event: done');
  });

  it('uses an injected ProfileLoader (retrieval swap point)', async () => {
    const res = await handleAnswer(post({ question: 'Hello?', profileId: 'james' }), env(), mockFetch((_url, init) => {
      expect(JSON.parse(String(init?.body)).systemInstruction.parts[1].text).toContain('from-loader');
      return stream();
    }), { get: async () => ({ id: 'james', name: 'James', markdown: 'from-loader' }) });
    expect(await res.text()).toContain('event: done');
  });

  it('maps cvBackground to extra notes without a selected profile', async () => {
    const res = await handleAnswer(post({ question: 'Hello?', cvBackground: 'Legacy note' }), env(), mockFetch((_url, init) => {
      const parts = JSON.parse(String(init?.body)).systemInstruction.parts;
      expect(parts).toHaveLength(2);
      expect(parts[1].text).toContain('Legacy note');
      return stream();
    }));
    expect(await res.text()).toContain('event: done');
  });

  it('extracts a full question across events and skips thought parts', async () => {
    const sse = event({ candidates: [{ content: { parts: [
      { text: 'Private reasoning <<<QUESTION>>>Wrong?<<<END>>>', thought: true },
      { text: '<<<QUES' },
    ] } }] }) + event(candidate('TION>>>Full question with preamble and both parts?<<<EN')) +
      event(candidate('D>>>I would start with the rollback plan.', 'STOP'));
    const res = await handleAnswer(post({ conversation: 'Transcript', extractQuestion: true }), env(), mockFetch(() => new Response(sse)));
    expect(await readEvents(res)).toEqual([
      { event: 'question', data: { question: 'Full question with preamble and both parts?' } },
      { event: 'token', data: { text: 'I would start with the rollback plan.' } },
      { event: 'done', data: {} },
    ]);
  });

  it('accepts CRLF SSE split at arbitrary byte boundaries, including UTF-8', async () => {
    const encoded = new TextEncoder().encode((event(candidate('粵語答案。')) + event(candidate('Done.', 'STOP'))).replace(/\n/g, '\r\n'));
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    const res = await handleAnswer(post({ question: 'Hello?' }), env(), mockFetch(() => new Response(body)));
    const events = await readEvents(res);
    expect(events.filter((e) => e.event === 'token').map((e) => e.data)).toEqual([{ text: '粵語答案。' }, { text: 'Done.' }]);
    expect(events.at(-1)?.event).toBe('done');
  });

  it('buffers long extracted questions beyond 400 characters', async () => {
    const question = `Preamble ${'x'.repeat(500)} then part A and part B?`;
    const res = await handleAnswer(post({ conversation: 'Transcript', extractQuestion: true }), env(), mockFetch(() =>
      new Response(event(candidate(`<<<QUESTION>>>${question.slice(0, 450)}`)) + event(candidate(`${question.slice(450)}<<<END>>>Answer`, 'STOP')))));
    expect(await readEvents(res)).toContainEqual({ event: 'question', data: { question } });
  });

  it('keeps the 400-character fallback when extraction is not requested', async () => {
    const text = 'x'.repeat(401);
    const res = await handleAnswer(post({ conversation: 'Transcript', force: true }), env(), mockFetch(() => stream(text)));
    expect(await readEvents(res)).toEqual([
      { event: 'question', data: { question: '' } }, { event: 'token', data: { text } }, { event: 'done', data: {} },
    ]);
  });

  it('flushes a short unmarked answer at successful completion', async () => {
    const res = await handleAnswer(post({ conversation: 'Transcript', extractQuestion: true }), env(), mockFetch(() => stream('Short answer')));
    expect(await readEvents(res)).toEqual([
      { event: 'question', data: { question: '' } }, { event: 'token', data: { text: 'Short answer' } }, { event: 'done', data: {} },
    ]);
  });

  it('uses a larger maxOutputTokens for one-way video', async () => {
    const res = await handleAnswer(post({ question: 'Tell me about yourself.', templateId: 'interview-oneway-video' }), env(), mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.generationConfig.maxOutputTokens).toBe(2048 + 2048);
      expect(body.systemInstruction.parts[0].text).toContain('HireVue');
      return stream();
    }));
    expect(await res.text()).toContain('event: done');
  });

  it('extracts from all transcript segments and treats the Jev hint as a fragment', async () => {
    const res = await handleAnswer(post({
      conversation: 'lovely stuff so moving on\ntalk me through a time you led a migration\nand what would you do differently',
      extractQuestion: true, questionHint: 'talk me through a time you led a migration', previousQuestion: 'tell me about yourself',
    }), env(), mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      const user = body.contents[0].parts[0].text;
      expect(user).not.toMatch(/^Question:/);
      for (const text of ['lovely stuff so moving on', 'talk me through a time you led a migration', 'and what would you do differently', 'Detector hint']) expect(user).toContain(text);
      expect(body.systemInstruction.parts.some((b: { text: string }) => b.text.includes('never truncate'))).toBe(true);
      return stream('<<<QUESTION>>>Moving on, talk me through a migration and what you would do differently.<<<END>>>I would start with the rollback plan.');
    }));
    const text = await res.text();
    expect(text).toContain('Moving on, talk me through a migration');
    expect(text).toContain('I would start with the rollback plan.');
    expect(text).not.toContain('no_new_question');
  });

  it.each(['STOP', 'MAX_TOKENS'])('completes with finishReason %s', async (reason) => {
    const res = await handleAnswer(post({ question: 'Hello?' }), env(), mockFetch(() => stream('Answer', reason)));
    expect((await readEvents(res)).at(-1)).toEqual({ event: 'done', data: {} });
  });

  it('parses a final event that has no trailing blank line', async () => {
    const sse = event(candidate('First ')) + `data: ${JSON.stringify(candidate('last', 'STOP'))}`;
    const res = await handleAnswer(post({ question: 'Hello?' }), env(), mockFetch(() => new Response(sse)));
    const text = await res.text();
    expect(text).toContain('"text":"last"');
    expect(text).toContain('event: done');
    expect(text).not.toContain('event: error');
  });

  it.each([
    ['gemini-3.8-flash', 'low'],
    ['gemini-3.5-flash-lite', 'minimal'],
  ])('asks %s for thinking level %s', async (model, level) => {
    let body: any;
    await handleAnswer(post({ question: 'Hello?', model }), env(), mockFetch((_url, init) => {
      body = JSON.parse(String(init?.body));
      return stream();
    }));
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: level });
  });

  it.each(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'OTHER'])('reports finishReason %s as an error without done', async (reason) => {
    const res = await handleAnswer(post({ question: 'Hello?' }), env(), mockFetch(() =>
      new Response(event(candidate('Partial answer')) + event(candidate('', reason)))));
    const text = await res.text();
    expect(text).toContain('Partial answer');
    expect(text).toContain('event: error');
    expect(text).toContain(reason);
    expect(text).not.toContain('event: done');
  });

  it.each([
    [{ promptFeedback: { blockReason: 'BLOCKLIST' } }, 'BLOCKLIST'],
    [{ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exhausted' } }, 'Quota exhausted'],
  ])('reports an upstream block or error object', async (payload, message) => {
    const res = await handleAnswer(post({ question: 'Hello?' }), env(), mockFetch(() => new Response(event(payload))));
    const text = await res.text();
    expect(text).toContain('event: error');
    expect(text).toContain(message);
    expect(text).not.toContain('event: done');
  });

  it('reports a stream ending without finishReason as an error', async () => {
    const res = await handleAnswer(post({ question: 'Hello?' }), env(), mockFetch(() => new Response(event(candidate('Partial answer')))));
    const text = await res.text();
    expect(text).toContain('Partial answer');
    expect(text).toContain('event: error');
    expect(text).toContain('Gemini stream ended before finishReason');
    expect(text).not.toContain('event: done');
  });

  it('emits only numeric Gemini fields from the last usageMetadata', async () => {
    const sse = event({ usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }) +
      event({ ...candidate('Answer', 'STOP') as object, usageMetadata: {
        promptTokenCount: 100, candidatesTokenCount: 12, thoughtsTokenCount: 0,
        cachedContentTokenCount: 80, totalTokenCount: 112, ignored: 99,
      } });
    const res = await handleAnswer(post({ question: 'Hello?' }), env(), mockFetch(() => new Response(sse)));
    const events = await readEvents(res);
    expect(events.filter((e) => e.event === 'usage')).toEqual([{ event: 'usage', data: {
      promptTokenCount: 100, candidatesTokenCount: 12, thoughtsTokenCount: 0,
      cachedContentTokenCount: 80, totalTokenCount: 112,
    } }]);
    expect(events.at(-1)?.event).toBe('done');
    const invalid = await handleAnswer(post({ question: 'Hello?' }), env(), mockFetch(() => new Response(event({
      ...candidate('Answer', 'STOP') as object,
      usageMetadata: { promptTokenCount: '100', candidatesTokenCount: null, thoughtsTokenCount: 0 },
    }))));
    expect(await readEvents(invalid)).toContainEqual({ event: 'usage', data: { thoughtsTokenCount: 0 } });
  });

  it.each([429, 400, 503])('maps upstream HTTP %s and logs at most 400 body characters', async (status) => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await handleAnswer(post({ question: 'Hello?' }), env(), mockFetch(() => textResponse('x'.repeat(1000), status)));
      expect(res.status).toBe(status === 429 ? 429 : 502);
      expect(await res.json()).toEqual(status === 429 ? { error: 'Gemini free-tier quota reached' } : { error: 'Gemini answer request failed', status });
      expect(JSON.parse(logger.mock.calls[0][0])).toEqual({ message: 'gemini answer request failed', status, body: 'x'.repeat(400) });
    } finally { logger.mockRestore(); }
  });

  it('returns 503 without a Gemini key and never calls upstream', async () => {
    const fetchImpl = vi.fn();
    const res = await handleAnswer(post({ question: 'Hello?' }), mockEnv(), fetchImpl);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'GEMINI_API_KEY is not configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects unknown profile ids without calling upstream', async () => {
    const fetchImpl = vi.fn();
    const res = await handleAnswer(post({ question: 'Hello?', profileId: 'secret-cv' }), env(), fetchImpl);
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns skip and done SSE when the question is unchanged', async () => {
    const fetchImpl = vi.fn();
    const res = await handleAnswer(post({ question: 'Hello?', previousQuestion: 'hello?' }), env(), fetchImpl);
    expect(await readEvents(res)).toEqual([{ event: 'skip', data: { reason: 'no_new_question' } }, { event: 'done', data: {} }]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
