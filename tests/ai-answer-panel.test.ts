import { describe, expect, it } from 'vitest';
import { createDebouncedDetector } from '../client/src/detectors/httpDetector';
import {
  onShowAiAnswerChange,
  parseShowAiAnswer,
  shouldRunQuestionDetect,
  splitContainerClass,
  transcriptPaneClass,
} from '../shared/aiAnswerPanel';

describe('AI Answer panel toggle', () => {
  it('lets a saved boolean win over the template default', () => {
    expect(parseShowAiAnswer(false, true)).toBe(false);
    expect(parseShowAiAnswer(true, false)).toBe(true);
    expect(parseShowAiAnswer(undefined, true)).toBe(true);
    expect(parseShowAiAnswer(undefined, false)).toBe(false);
  });

  it('does not run detect or answer while the panel is off', () => {
    expect(
      shouldRunQuestionDetect({
        showAiAnswer: false,
        autoDetect: true,
        isRecording: true,
        hasFinals: true,
        finalSig: '1|hello|t',
        ignoreUntilFinalSig: null,
      }),
    ).toBe(false);
    expect(
      shouldRunQuestionDetect({
        showAiAnswer: true,
        autoDetect: false,
        isRecording: true,
        hasFinals: true,
        finalSig: '1|hello|t',
        ignoreUntilFinalSig: null,
      }),
    ).toBe(false);
  });

  it('ignores the transcript snapshot from the moment the panel is re-enabled', () => {
    const sig = '3|old question|2026-01-01';
    const change = onShowAiAnswerChange(false, true, 2, sig);
    expect(change.resetGate).toBe(true);
    expect(change.ignoreUntilFinalSig).toBe(sig);
    expect(change.latchEndId).toBe(2);
    expect(
      shouldRunQuestionDetect({
        showAiAnswer: true,
        autoDetect: true,
        isRecording: true,
        hasFinals: true,
        finalSig: sig,
        ignoreUntilFinalSig: change.ignoreUntilFinalSig,
      }),
    ).toBe(false);
    expect(
      shouldRunQuestionDetect({
        showAiAnswer: true,
        autoDetect: true,
        isRecording: true,
        hasFinals: true,
        finalSig: '4|new question|2026-01-02',
        ignoreUntilFinalSig: change.ignoreUntilFinalSig,
      }),
    ).toBe(true);
  });

  it('gives the transcript full width and height in every split when the panel is off', () => {
    for (const layout of ['transcript-left', 'transcript-right', 'transcript-top', 'transcript-bottom'] as const) {
      expect(splitContainerClass(layout, false)).toBe('block w-full h-full');
      expect(splitContainerClass(layout, true)).toMatch(/flex/);
    }
    expect(transcriptPaneClass(false)).toContain('w-full');
    expect(transcriptPaneClass(false)).toContain('h-[calc(100vh-12rem)]');
    expect(transcriptPaneClass(true)).toContain('h-[50vh]');
  });

  it('cancels a pending Jev detect when the panel turns off', async () => {
    let calls = 0;
    const inner = {
      detect: async () => {
        calls += 1;
        return { shouldAnswer: false, question: null, detector: 'jev' };
      },
    };
    const detector = createDebouncedDetector(inner, 20);
    void detector.detect({
      segments: [{ index: 0, text: 'hello?' }],
      windowSeconds: 90,
      lastAnsweredQuestion: null,
      threshold: 0.6,
    });
    detector.cancel?.();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls).toBe(0);
  });
});
