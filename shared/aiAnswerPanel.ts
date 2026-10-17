export type SplitLayout = 'transcript-left' | 'transcript-right' | 'transcript-top' | 'transcript-bottom';

const SPLIT: Record<SplitLayout, string> = {
  'transcript-left': 'flex flex-col md:flex-row',
  'transcript-right': 'flex flex-col md:flex-row-reverse',
  'transcript-top': 'flex flex-col',
  'transcript-bottom': 'flex flex-col-reverse',
};

/** Saved user toggle wins; missing key falls back to the session template default. */
export function parseShowAiAnswer(saved: unknown, templateDefault = true): boolean {
  if (typeof saved === 'boolean') return saved;
  return templateDefault;
}

export function onShowAiAnswerChange(
  wasOn: boolean,
  nowOn: boolean,
  newestFinalId: number | null,
  finalSig: string,
): { resetGate: boolean; ignoreUntilFinalSig: string | null; latchEndId: number | null } {
  if (wasOn === nowOn) {
    return { resetGate: false, ignoreUntilFinalSig: null, latchEndId: null };
  }
  if (!nowOn) {
    return { resetGate: true, ignoreUntilFinalSig: null, latchEndId: null };
  }
  return {
    resetGate: true,
    ignoreUntilFinalSig: finalSig,
    latchEndId: newestFinalId ?? -1,
  };
}

export function shouldRunQuestionDetect(opts: {
  showAiAnswer: boolean;
  autoDetect: boolean;
  isRecording: boolean;
  hasFinals: boolean;
  finalSig: string;
  ignoreUntilFinalSig: string | null;
}): boolean {
  if (!opts.showAiAnswer || !opts.autoDetect || !opts.isRecording || !opts.hasFinals) return false;
  if (opts.ignoreUntilFinalSig != null && opts.finalSig === opts.ignoreUntilFinalSig) return false;
  return true;
}

export function splitContainerClass(layout: SplitLayout, showAiAnswer: boolean): string {
  if (!showAiAnswer) return 'block w-full h-full';
  return `${SPLIT[layout]} gap-4`;
}

export function transcriptPaneClass(showAiAnswer: boolean): string {
  return showAiAnswer
    ? 'h-[50vh] md:h-[calc(100vh-12rem)] rounded-lg'
    : 'h-[calc(100vh-12rem)] w-full rounded-lg';
}
