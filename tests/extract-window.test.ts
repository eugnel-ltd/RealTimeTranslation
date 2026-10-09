import { describe, expect, it } from 'vitest';
import { generousCutoffMs, joinSegmentText, segmentsAfterCutoff, sliceFromQuestionStart } from '../shared/extractWindow';
import { pinStateOnScroll, scrollTopForAnswer } from '../client/src/scrollPin';

describe('extract window', () => {
  it('takes the longer of 120s and since last answer, capped at 3 minutes', () => {
    const now = 1_000_000;
    expect(generousCutoffMs(now, 120, null)).toBe(now - 120_000);
    expect(generousCutoffMs(now, 120, now - 10_000)).toBe(now - 120_000);
    expect(generousCutoffMs(now, 120, now - 150_000)).toBe(now - 150_000);
    expect(generousCutoffMs(now, 120, now - 400_000)).toBe(now - 180_000);
  });

  it('never drops segments after the suggested start', () => {
    const segs = [
      { index: 0, text: 'Small talk.' },
      { index: 1, text: 'Context about the team.' },
      { index: 2, text: 'And also, what would you change?' },
    ];
    expect(sliceFromQuestionStart(segs, 1).map((s) => s.index)).toEqual([1, 2]);
    expect(sliceFromQuestionStart(segs, null)).toEqual(segs);
    expect(joinSegmentText(sliceFromQuestionStart(segs, 1))).toContain('what would you change');
  });

  it('keeps segments without timestamps', () => {
    const segs = [{ index: 0, text: 'Hello' }];
    expect(segmentsAfterCutoff(segs, Date.now()).length).toBe(1);
  });
});

describe('scroll pin', () => {
  it('stays at top while pinned and snaps to top on a new answer', () => {
    expect(pinStateOnScroll(0)).toBe(true);
    expect(pinStateOnScroll(80)).toBe(false);
    expect(scrollTopForAnswer(true, false)).toBe(0);
    expect(scrollTopForAnswer(false, false)).toBeNull();
    expect(scrollTopForAnswer(false, true)).toBe(0);
  });
});
