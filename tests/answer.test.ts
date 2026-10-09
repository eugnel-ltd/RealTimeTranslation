import { describe, expect, it } from 'vitest';
import { buildAnswerSystemBlocks, handleAnswer, shouldSkipAnswer } from '../worker/src/answer';
import { mockEnv, mockFetch, mockKv, textResponse } from './helpers';

describe('answer', () => {
  it('skips duplicate questions unless forced', () => {
    expect(shouldSkipAnswer('What is your stack?', 'what is your  stack?', false)).toBe(true);
    expect(shouldSkipAnswer('What is your stack?', 'what is your  stack?', true)).toBe(false);
    expect(shouldSkipAnswer('Old', 'New question?', false)).toBe(false);
  });

  it('asks for a spoken STAR answer and caches the profile block', () => {
    const blocks = buildAnswerSystemBlocks({
      knownQuestion: true,
      userContext: 'Staff interview at a Cloudflare shop',
      extraNotes: 'Emphasise incidents.',
      profileName: 'James',
      profileMarkdown: 'Staff engineer at Eugnel, 8 years TypeScript.',
    });
    const joined = blocks.map((b) => b.text).join('\n');
    expect(joined).toContain('STAR');
    expect(joined).toContain('spoken-style');
    expect(joined).toContain('Staff interview at a Cloudflare shop');
    expect(joined).toContain('Staff engineer at Eugnel');
    expect(joined).toContain('[team size]');
    expect(joined).toContain('Do not refuse with hedges');
    const cached = blocks.find((b) => b.cache_control?.type === 'ephemeral');
    expect(cached?.text).toContain('Staff engineer at Eugnel');
    expect(blocks.at(-1)?.cache_control).toBeUndefined();
  });

  it('omits the cached profile block when markdown is empty', () => {
    const blocks = buildAnswerSystemBlocks({ knownQuestion: true, profileMarkdown: '  ' });
    expect(blocks.some((b) => b.cache_control)).toBe(false);
  });

  it('loads the selected profile from KV and sends cache_control', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":9000,"cache_creation_input_tokens":8000,"cache_read_input_tokens":0}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"I stay calm."}}',
      '',
      '',
    ].join('\n');
    const kv = mockKv({
      'profile:james': { value: 'Staff engineer at Eugnel', metadata: { name: 'James' } },
    });
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toContain('api.anthropic.com/v1/messages');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('claude-sonnet-5-5');
      expect(body.output_config.effort).toBe('low');
      expect(Array.isArray(body.system)).toBe(true);
      const cached = body.system.find((b: { cache_control?: unknown }) => b.cache_control);
      expect(cached.cache_control).toEqual({ type: 'ephemeral' });
      expect(cached.text).toContain('Staff engineer at Eugnel');
      expect(cached.text).not.toContain('Emphasise incidents');
      expect((init?.headers as Record<string, string>)['anthropic-beta']).toContain('prompt-caching');
      return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const res = await handleAnswer(
      new Request('https://rtt.eugnel.com/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-5-5',
          question: 'What is your greatest strength?',
          conversation: 'What is your greatest strength?',
          userContext: 'Interviewing for Staff',
          extraNotes: 'Emphasise incidents',
          profileId: 'james',
          force: true,
        }),
      }),
      mockEnv({ ANTHROPIC_API_KEY: 'sk', PROFILES: kv }),
      fetchImpl,
    );
    const text = await res.text();
    expect(text).toContain('I stay calm.');
    expect(text).toContain('event: usage');
    expect(text).toContain('cache_creation_input_tokens');
    expect(text).toContain('event: done');
  });

  it('uses an injected ProfileLoader (retrieval swap point)', async () => {
    const sse = [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      '',
      '',
    ].join('\n');
    const fetchImpl = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      const cached = body.system.find((b: { cache_control?: unknown }) => b.cache_control);
      expect(cached.text).toContain('from-loader');
      return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const res = await handleAnswer(
      new Request('https://rtt.eugnel.com/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Hello?',
          conversation: 'Hello?',
          profileId: 'james',
          force: true,
        }),
      }),
      mockEnv({ ANTHROPIC_API_KEY: 'sk' }),
      fetchImpl,
      { get: async () => ({ id: 'james', name: 'James', markdown: 'from-loader' }) },
    );
    expect(res.ok).toBe(true);
    expect(await res.text()).toContain('ok');
  });

  it('does not cache when no profile is selected; maps cvBackground to extra notes', async () => {
    const sse = [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      '',
      '',
    ].join('\n');
    const fetchImpl = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.system.some((b: { cache_control?: unknown }) => b.cache_control)).toBe(false);
      expect(body.system.at(-1).text).toContain('Legacy note');
      return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const res = await handleAnswer(
      new Request('https://rtt.eugnel.com/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Hello?',
          conversation: 'Hello?',
          cvBackground: 'Legacy note',
          force: true,
        }),
      }),
      mockEnv({ ANTHROPIC_API_KEY: 'sk' }),
      fetchImpl,
    );
    expect(res.ok).toBe(true);
  });

  it('rejects unknown profile ids', async () => {
    const res = await handleAnswer(
      new Request('https://rtt.eugnel.com/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Hello?',
          conversation: 'Hello?',
          profileId: 'secret-cv',
          force: true,
        }),
      }),
      mockEnv({ ANTHROPIC_API_KEY: 'sk' }),
      mockFetch(() => textResponse('should not be called', 500)),
    );
    expect(res.status).toBe(400);
  });

  it('returns skip SSE when the question is unchanged', async () => {
    const res = await handleAnswer(
      new Request('https://rtt.eugnel.com/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Hello?',
          previousQuestion: 'hello?',
          conversation: 'Hello?',
        }),
      }),
      mockEnv({ ANTHROPIC_API_KEY: 'sk' }),
      mockFetch(() => textResponse('should not be called', 500)),
    );
    expect(await res.text()).toContain('no_new_question');
  });
});
