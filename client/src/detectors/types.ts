export type TranscriptSegment = {
  index: number;
  text: string;
  timestamp?: string;
};

export type QuestionDetectorInput = {
  segments: TranscriptSegment[];
  windowSeconds: 30 | 60;
  lastAnsweredQuestion: string | null;
  threshold: number;
};

export type QuestionDetectorResult = {
  shouldAnswer: boolean;
  question: string | null;
  probability?: number;
  detector: string;
  skippedReason?: string;
};

/** Swap this for an external question-detection service later. */
export interface QuestionDetector {
  detect(input: QuestionDetectorInput): Promise<QuestionDetectorResult>;
}
