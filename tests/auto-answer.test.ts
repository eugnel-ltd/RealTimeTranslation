import { describe, expect, it } from 'vitest';
import { isRepeatBySegmentId, planAutoAnswer, resolveExtractStart, sameQuestion } from '../shared/autoAnswer';
import { shouldSkipAnswer } from '../worker/src/answer';

const segs = [
  { index: 0, text: 'great thanks for that' },
  { index: 1, text: 'lovely stuff so moving on from that technical side' },
  { index: 2, text: 'talk me through a time you led a migration' },
  { index: 3, text: 'and what would you do differently' },
  { index: 6, text: 'old question about kubernetes' },
  { index: 7, text: 'how do you stay up to speed on changing regulations' },
  { index: 8, text: 'how do you keep abreast of that what do you do' },
];

describe('planAutoAnswer', () => {
  it('sends every segment from the start through the latest, with extractQuestion and no known question', () => {
    const plan = planAutoAnswer({
      windowSegments: segs.slice(0, 4),
      startIndex: 1,
      hintText: 'and what would you do differently',
      lastAnsweredEndId: null,
    });
    expect(plan.skip).toBe(false);
    if (plan.skip) throw new Error('expected extract plan');
    expect(plan.extractQuestion).toBe(true);
    expect(plan.conversation).toContain('moving on from that technical side');
    expect(plan.conversation).toContain('and what would you do differently');
    expect(plan.conversation).not.toContain('great thanks for that');
    expect(plan.endIndex).toBe(3);
  });

  it('does not skip a new question when Jev still points at the previous start id', () => {
    const window = segs.filter((s) => s.index >= 6);
    const fullOld = 'old question about kubernetes operators and how you ran the cluster';
    expect(isRepeatBySegmentId(8, 6)).toBe(false);
    expect(resolveExtractStart(6, 6, 8)).toBe(7);
    const plan = planAutoAnswer({
      windowSegments: window,
      startIndex: 6,
      hintText: 'old question about kubernetes',
      lastAnsweredEndId: 6,
      lastAnswered: fullOld,
    });
    expect(plan.skip).toBe(false);
    if (plan.skip) throw new Error('expected new question');
    expect(plan.startIndex).toBe(7);
    expect(plan.conversation).toContain('stay up to speed');
    expect(plan.conversation).toContain('keep abreast');
    expect(plan.conversation).not.toContain('old question about kubernetes');
    expect(sameQuestion(fullOld, 'old question about kubernetes')).toBe(true);
  });

  it('skips when there is no speech after the last answered end segment', () => {
    expect(
      planAutoAnswer({
        windowSegments: segs.filter((s) => s.index <= 6),
        startIndex: 6,
        hintText: 'old question about kubernetes',
        lastAnsweredEndId: 6,
      }).skip,
    ).toBe(true);
  });

  it('falls back to the full window when question-start is missing and speech is new', () => {
    const plan = planAutoAnswer({
      windowSegments: segs.slice(0, 4),
      startIndex: null,
      hintText: 'and what would you do differently',
      lastAnsweredEndId: null,
    });
    expect(plan.skip).toBe(false);
    if (plan.skip) throw new Error('expected fallback plan');
    expect(plan.conversation).toContain('great thanks for that');
    expect(plan.conversation).toContain('and what would you do differently');
  });
});

describe('shouldSkipAnswer extract path', () => {
  it('does not skip an extract-only request that has no knownQuestion', () => {
    expect(shouldSkipAnswer('previous full question', undefined, false, true)).toBe(false);
    expect(shouldSkipAnswer('previous full question', undefined, false, false)).toBe(true);
    expect(shouldSkipAnswer('Hello?', 'hello?', false, false)).toBe(true);
  });
});
