import { detectQuestion } from '../services/api';
import type { QuestionDetector, QuestionDetectorInput, QuestionDetectorResult } from './types';

/** Default detector: Worker Jev (TypeSafe System One), Claude fallback server-side. */
export class HttpQuestionDetector implements QuestionDetector {
  async detect(input: QuestionDetectorInput): Promise<QuestionDetectorResult> {
    const result = await detectQuestion({
      segments: input.segments,
      windowSeconds: input.windowSeconds,
      lastAnsweredQuestion: input.lastAnsweredQuestion,
      threshold: input.threshold,
    });
    const probability = minDefined(
      result.probabilities.newQuestionFromOtherParty,
      result.probabilities.isInterviewQuestion,
    );
    return {
      shouldAnswer: result.shouldAnswer,
      question: result.question,
      probability,
      detector: result.detector,
      skippedReason: result.shouldAnswer ? undefined : result.fallbackReason || 'below_threshold',
    };
  }
}

function minDefined(a: number | null, b: number | null): number | undefined {
  if (a == null || b == null) return a ?? b ?? undefined;
  return Math.min(a, b);
}

export function createDebouncedDetector(inner: QuestionDetector, waitMs = 400): QuestionDetector {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: {
    input: QuestionDetectorInput;
    resolve: (v: QuestionDetectorResult) => void;
    reject: (e: unknown) => void;
  } | null = null;

  return {
    detect(input) {
      return new Promise((resolve, reject) => {
        if (timer) clearTimeout(timer);
        pending = { input, resolve, reject };
        timer = setTimeout(() => {
          const job = pending;
          pending = null;
          if (!job) return;
          inner.detect(job.input).then(job.resolve, job.reject);
        }, waitMs);
      });
    },
  };
}
