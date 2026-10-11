import { describe, expect, it } from 'vitest';
import { planAutoAnswer, sameQuestion } from '../shared/autoAnswer';
import { shouldSkipAnswer } from '../worker/src/answer';

const segs = [
  { index: 0, text: 'great thanks for that' },
  { index: 1, text: 'lovely stuff so moving on from that technical side' },
  { index: 2, text: 'talk me through a time you led a migration' },
  { index: 3, text: 'and what would you do differently' },
];

describe('planAutoAnswer', () => {
  it('sends every segment from the start through the latest, with extractQuestion and no known question', () => {
    const plan = planAutoAnswer({
      windowSegments: segs,
      startIndex: 1,
      hintText: 'lovely stuff so moving on from that technical side',
      lastAnswered: null,
    });
    expect(plan.skip).toBe(false);
    if (plan.skip) throw new Error('expected extract plan');
    expect(plan.extractQuestion).toBe(true);
    expect(plan.conversation).toContain('moving on from that technical side');
    expect(plan.conversation).toContain('talk me through a time you led a migration');
    expect(plan.conversation).toContain('and what would you do differently');
    expect(plan.conversation).not.toContain('great thanks for that');
    expect(plan.hint).toContain('moving on from that technical side');
  });

  it('does not re-trigger when lastAnswered is the extracted full question or the Jev hint', () => {
    const full =
      'Lovely stuff, so moving on from that technical side: talk me through a time you led a migration, and what would you do differently?';
    expect(
      planAutoAnswer({
        windowSegments: segs,
        startIndex: 1,
        hintText: 'talk me through a time you led a migration',
        lastAnswered: full,
      }).skip,
    ).toBe(true);
    expect(
      planAutoAnswer({
        windowSegments: segs,
        startIndex: 1,
        hintText: 'talk me through a time you led a migration',
        lastAnswered: null,
        lastHint: 'talk me through a time you led a migration',
      }).skip,
    ).toBe(true);
    expect(sameQuestion(full, 'talk me through a time you led a migration')).toBe(true);
  });

  it('falls back to the full 90–120s window when question-start is missing', () => {
    const plan = planAutoAnswer({
      windowSegments: segs,
      startIndex: null,
      hintText: 'and what would you do differently',
      lastAnswered: null,
    });
    expect(plan.skip).toBe(false);
    if (plan.skip) throw new Error('expected fallback plan');
    expect(plan.conversation).toContain('great thanks for that');
    expect(plan.conversation).toContain('and what would you do differently');
    expect(plan.startIndex).toBeNull();
  });
});

describe('shouldSkipAnswer extract path', () => {
  it('does not skip an extract-only request that has no knownQuestion', () => {
    expect(shouldSkipAnswer('previous full question', undefined, false, true)).toBe(false);
    expect(shouldSkipAnswer('previous full question', undefined, false, false)).toBe(true);
    expect(shouldSkipAnswer('Hello?', 'hello?', false, false)).toBe(true);
  });
});
