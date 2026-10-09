import { describe, expect, it } from 'vitest';
import { buildAnswerSystem, handleAnswer, shouldSkipAnswer } from '../worker/src/answer';
import { mockEnv, mockFetch, textResponse } from './helpers';

describe('answer', () => {
  it('skips duplicate questions unless forced', () => {
    expect(shouldSkipAnswer('What is your stack?', 'what is your  stack?', false)).toBe(true);
    expect(shouldSkipAnswer('What is your stack?', 'what is your  stack?', true)).toBe(false);
    expect(shouldSkipAnswer('Old', 'New question?', false)).toBe(false);
  });

  it('asks for a spoken STAR answer grounded in context and CV', () => {
    const system = buildAnswerSystem({
      knownQuestion: true,
      userContext: 'Staff interview at a Cloudflare shop',
      cvBackground: 'Staff engineer at Eugnel, 8 years TypeScript.',
    });
    expect(system).toContain('STAR');
    expect(system).toContain('spoken-style');
    expect(system).toContain('Staff interview at a Cloudflare shop');
    expect(system).toContain('Staff engineer at Eugnel');
    expect(system).toContain('[team size]');
    expect(system).toContain('Do not refuse with hedges');
  });

  it('streams Anthropic text deltas as SSE tokens and reports the known question', async () => {
    const sse = [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"I stay calm."}}',
      '',
      '',
    ].join('\n');
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toContain('api.anthropic.com/v1/messages');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('claude-sonnet-5-5');
      expect(body.stream).toBe(true);
      expect(body.output_config.effort).toBe('low');
      expect(body.system).toContain('STAR');
      expect(body.system).toContain('Staff engineer at Eugnel');
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
          cvBackground: 'Staff engineer at Eugnel',
          force: true,
        }),
      }),
      mockEnv({ ANTHROPIC_API_KEY: 'sk' }),
      fetchImpl,
    );
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('event: question');
    expect(text).toContain('What is your greatest strength?');
    expect(text).toContain('I stay calm.');
    expect(text).toContain('event: done');
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
