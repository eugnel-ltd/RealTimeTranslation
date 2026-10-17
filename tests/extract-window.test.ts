import { describe, expect, it } from 'vitest';
import {
  capFromEndByWords,
  capKeepingStart,
  coerceDetectWindowSeconds,
  generousCutoffMs,
  joinSegmentText,
  segmentsAfterCutoff,
  sliceFromQuestionStart,
  windowForDetect,
  wordCount,
} from '../shared/extractWindow';
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

  it('caps the detect window from the end at ~300 words', () => {
    const pad = Array.from({ length: 20 }, (_, i) => ({
      index: i,
      text: Array.from({ length: 20 }, () => 'word').join(' '),
    }));
    const tail = { index: 20, text: 'tell me about a production incident you owned last year' };
    const capped = capFromEndByWords([...pad, tail], 300);
    expect(wordCount(joinSegmentText(capped))).toBeLessThanOrEqual(300);
    expect(capped.at(-1)?.text).toContain('production incident');
    expect(capped[0].index).toBeGreaterThan(0);
  });

  it('extends back to the question-start id even past the time window', () => {
    const now = 1_000_000;
    const segs = [
      { index: 2, text: 'long case prompt part one', timestamp: new Date(now - 180_000).toISOString() },
      { index: 8, text: 'and how do you keep abreast of that', timestamp: new Date(now - 5_000).toISOString() },
    ];
    const win = windowForDetect(segs, now, 120, 500, 2);
    expect(win.map((s) => s.index)).toEqual([2, 8]);
  });

  it('keeps the start segment when capping a long case prompt', () => {
    const start = { index: 3, text: Array.from({ length: 40 }, () => 'start').join(' ') };
    const mid = Array.from({ length: 30 }, (_, i) => ({
      index: 4 + i,
      text: Array.from({ length: 20 }, () => 'pad').join(' '),
    }));
    const end = { index: 40, text: 'what would you do' };
    const kept = capKeepingStart([start, ...mid, end], 500, 3);
    expect(kept[0].index).toBe(3);
    expect(kept.at(-1)?.index).toBe(40);
  });

  it('maps legacy 30/60 windows onto 90/120', () => {
    expect(coerceDetectWindowSeconds(90)).toBe(90);
    expect(coerceDetectWindowSeconds(120)).toBe(120);
    expect(coerceDetectWindowSeconds(30)).toBe(90);
    expect(coerceDetectWindowSeconds(60)).toBe(120);
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
