import { describe, expect, it, beforeEach } from 'vitest';
import { earliestCumulativeStart } from '../shared/extractWindow';
import {
  handleDetectQuestion,
  resetJevCooldown,
  buildJevPayload,
  buildJevStartPayload,
} from '../worker/src/detect-question';
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

const startSegments = [
  { index: 4, text: 'great thanks for that' },
  { index: 5, text: 'lovely stuff so moving on from that technical side' },
  { index: 6, text: 'talk me through a time you led a migration' },
  { index: 7, text: 'and what would you do differently' },
];

describe('earliestCumulativeStart', () => {
  it('picks the earliest key where cumulative probability from segment 1 reaches 0.3', () => {
    const keys = ['1', '2', '3', '4'];
    // argmax is 3 (0.50); cum≥0.3 hits at 2 (0.20+0.25)
    expect(
      earliestCumulativeStart({ '1': 0.2, '2': 0.25, '3': 0.5, '4': 0.05, none: 0.0 }, keys, 0.3),
    ).toBe('2');
  });

  it('picks the first segment when it already holds ≥0.3 (errs longer)', () => {
    expect(earliestCumulativeStart({ '1': 0.4, '2': 0.5, '3': 0.1 }, ['1', '2', '3'], 0.3)).toBe('1');
  });

  it('returns null when mass never reaches 0.3', () => {
    expect(earliestCumulativeStart({ '1': 0.1, '2': 0.1, none: 0.8 }, ['1', '2'], 0.3)).toBeNull();
  });

  it('ignores none and missing keys', () => {
    expect(earliestCumulativeStart({ none: 0.9, '2': 0.4 }, ['1', '2'], 0.3)).toBe('2');
  });
});

describe('detect-question', () => {
  beforeEach(() => resetJevCooldown());

  it('asks Jev A noul + B numbered choice over a 90–120s window', () => {
    const payload = buildJevPayload(segments, '', 120, 'jev-latest');
    expect(payload.model).toBe('jev-latest');
    expect((payload.state as { window_seconds: number }).window_seconds).toBe(120);
    expect((payload.state as { transcript: string }).transcript).toContain('[1]');
    expect((payload.state as { transcript: string }).transcript).toContain('[2]');
    expect(payload.questions.has_substantive_question.type).toBe('noul');
    const startQ = payload.questions.question_start_segment;
    expect(startQ.type).toBe('choice');
    if (startQ.type !== 'choice') throw new Error('expected choice');
    expect(startQ.criteria['1']).toContain('Thanks for coming in');
    expect(startQ.criteria['2']).toContain('production incident');
    expect(startQ.criteria.none).toBeTruthy();
    expect(payload.questions.new_question_from_other_party).toBeUndefined();
    expect(payload.questions.is_interview_question).toBeUndefined();
  });

  it('triggers A when the noul meets the threshold and extracts from B cumulative start', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({
        model: 'jev-1.13.0',
        answers: {
          has_substantive_question: { type: 'noul', noul: 0.91 },
          question_start_segment: {
            type: 'choice',
            choice: '2',
            probabilities: { '1': 0.1, '2': 0.85, none: 0.05 },
            confidence: 0.8,
          },
        },
      }),
    );
    const res = await handleDetectQuestion(
      post({ segments, threshold: 0.6, windowSeconds: 120 }),
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

  it('uses default threshold 0.6 when omitted', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({
        model: 'jev-1.13.0',
        answers: {
          has_substantive_question: { type: 'noul', noul: 0.62 },
          question_start_segment: {
            type: 'choice',
            choice: '2',
            probabilities: { '1': 0.05, '2': 0.9, none: 0.05 },
            confidence: 0.9,
          },
        },
      }),
    );
    const res = await handleDetectQuestion(
      post({ segments, windowSeconds: 90 }),
      mockEnv({ TYPESAFE_API_KEY: 'ts' }),
      fetchImpl,
    );
    const body = (await res.json()) as { shouldAnswer: boolean };
    expect(body.shouldAnswer).toBe(true);
  });

  it('does not trigger below the threshold', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({
        model: 'jev-1.13.0',
        answers: {
          has_substantive_question: { type: 'noul', noul: 0.4 },
          question_start_segment: {
            type: 'choice',
            choice: '2',
            probabilities: { '1': 0.05, '2': 0.9, none: 0.05 },
            confidence: 1,
          },
        },
      }),
    );
    const res = await handleDetectQuestion(
      post({ segments, threshold: 0.6 }),
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

  it('question-start uses cumulative 0.3, not argmax', async () => {
    const payload = buildJevStartPayload(startSegments, '', 120, 'jev-latest');
    expect(payload.questions.question_start_segment.type).toBe('choice');
    expect(payload.questions.has_substantive_question).toBeUndefined();
    const fetchImpl = mockFetch(() =>
      jsonResponse({
        model: 'jev-1.13.0',
        answers: {
          question_start_segment: {
            type: 'choice',
            choice: '4',
            probabilities: { '1': 0.05, '2': 0.28, '3': 0.55, '4': 0.1, none: 0.02 },
            confidence: 0.55,
          },
        },
      }),
    );
    const res = await handleDetectQuestion(
      post({ segments: startSegments, mode: 'question-start', windowSeconds: 120 }),
      mockEnv({ TYPESAFE_API_KEY: 'ts' }),
      fetchImpl,
    );
    // cum: 0.05, 0.33 → key 2 → index 5 (preamble). argmax would be key 3 → index 6.
    expect(await res.json()).toMatchObject({
      detector: 'jev',
      shouldAnswer: false,
      segmentIndex: 5,
      question: null,
    });
  });

  it('question-start falls back to a full window when Jev is missing', async () => {
    const res = await handleDetectQuestion(
      post({ segments, mode: 'question-start' }),
      mockEnv({ TYPESAFE_API_KEY: undefined }),
      mockFetch(() => textResponse('should not call claude', 500)),
    );
    const body = (await res.json()) as { segmentIndex: number | null; fallbackReason?: string; shouldAnswer: boolean };
    expect(body.shouldAnswer).toBe(false);
    expect(body.segmentIndex).toBeNull();
    expect(body.fallbackReason).toBe('typesafe_unconfigured');
  });
});
