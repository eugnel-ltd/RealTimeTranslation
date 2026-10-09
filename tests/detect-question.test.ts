import { describe, expect, it, beforeEach } from 'vitest';
import { handleDetectQuestion, resetJevCooldown, buildJevPayload } from '../worker/src/detect-question';
import { jsonResponse, mockEnv, mockFetch, textResponse } from './helpers';

function post(body: unknown): Request {
  return new Request('https://rtt.eugnel.com/api/detect-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const segments = [
  { index: 0, text: 'Thanks for coming in.' },
  { index: 1, text: 'Tell me about a production incident you owned.' },
];

describe('detect-question', () => {
  beforeEach(() => resetJevCooldown());

  it('asks independent Jev Noul + Choice questions over named state', () => {
    const payload = buildJevPayload(segments, '', 60, 'jev-latest');
    expect(payload.questions.new_question_from_other_party.type).toBe('noul');
    expect(payload.questions.is_interview_question.type).toBe('noul');
    const segmentQ = payload.questions.question_segment;
    expect(segmentQ.type).toBe('choice');
    if (segmentQ.type !== 'choice') throw new Error('expected choice');
    expect(segmentQ.criteria['1']).toContain('production incident');
    expect(segmentQ.criteria.none).toBeTruthy();
  });

  it('triggers when both Nouls meet the threshold and a segment is selected', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({
        model: 'jev-1.13.0',
        answers: {
          new_question_from_other_party: { type: 'noul', noul: 0.91 },
          is_interview_question: { type: 'noul', noul: 0.88 },
          question_segment: {
            type: 'choice',
            choice: '1',
            probabilities: { '0': 0.05, '1': 0.9, none: 0.05 },
            confidence: 0.8,
          },
        },
      }),
    );
    const res = await handleDetectQuestion(
      post({ segments, threshold: 0.7, windowSeconds: 60 }),
      mockEnv({ TYPESAFE_API_KEY: 'ts' }),
      fetchImpl,
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      detector: 'jev',
      shouldAnswer: true,
      segmentIndex: 1,
      question: 'Tell me about a production incident you owned.',
    });
  });

  it('does not trigger below the threshold', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({
        model: 'jev-1.13.0',
        answers: {
          new_question_from_other_party: { type: 'noul', noul: 0.4 },
          is_interview_question: { type: 'noul', noul: 0.9 },
          question_segment: { type: 'choice', choice: '1', probabilities: { '1': 1, none: 0 }, confidence: 1 },
        },
      }),
    );
    const res = await handleDetectQuestion(
      post({ segments, threshold: 0.7 }),
      mockEnv({ TYPESAFE_API_KEY: 'ts' }),
      fetchImpl,
    );
    const body = (await res.json()) as { shouldAnswer: boolean; question: string | null };
    expect(body.shouldAnswer).toBe(false);
    expect(body.question).toBeNull();
  });

  it('falls back to Claude when TYPESAFE_API_KEY is missing', async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toContain('api.anthropic.com');
      return jsonResponse({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              question: 'Tell me about a production incident you owned.',
              segment_index: 1,
              is_new: true,
              is_interview_question: true,
            }),
          },
        ],
      });
    });
    const res = await handleDetectQuestion(
      post({ segments }),
      mockEnv({ ANTHROPIC_API_KEY: 'sk' }),
      fetchImpl,
    );
    const body = (await res.json()) as { detector: string; fallbackReason?: string; shouldAnswer: boolean };
    expect(body.detector).toBe('claude');
    expect(body.fallbackReason).toBe('typesafe_unconfigured');
    expect(body.shouldAnswer).toBe(true);
  });

  it('cools down 5 minutes after Jev 429 and uses Claude', async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes('typesafe.ai')) return textResponse('rate limited', 429);
      return jsonResponse({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              question: null,
              segment_index: null,
              is_new: false,
              is_interview_question: false,
            }),
          },
        ],
      });
    });
    const env = mockEnv({ TYPESAFE_API_KEY: 'ts', ANTHROPIC_API_KEY: 'sk' });
    const first = (await (await handleDetectQuestion(post({ segments }), env, fetchImpl, 1_000)).json()) as {
      fallbackReason?: string;
    };
    expect(first.fallbackReason).toBe('jev_transient');
    const second = (await (await handleDetectQuestion(post({ segments }), env, fetchImpl, 1_000 + 60_000)).json()) as {
      fallbackReason?: string;
    };
    expect(second.fallbackReason).toBe('jev_cooldown');
  });
});
