export type WindowSegment = {
  index: number;
  text: string;
  timestamp?: string;
};

const MAX_EXTRACT_BACK_MS = 180_000;

/** Jev decision-A window: last ~90–120s ≈ 200–300 words. */
export const DETECT_WINDOW_OPTIONS = [90, 120] as const;
export type DetectWindowSeconds = (typeof DETECT_WINDOW_OPTIONS)[number];
export const DEFAULT_DETECT_WINDOW_SECONDS: DetectWindowSeconds = 120;
export const DETECT_MAX_WORDS = 300;
export const DEFAULT_QUESTION_THRESHOLD = 0.6;
export const MIN_QUESTION_THRESHOLD = 0.4;
export const MAX_QUESTION_THRESHOLD = 0.95;
export const CUMULATIVE_START_TAU = 0.3;
export const SILENCE_CONFIRM_MS = 1000;

export function coerceDetectWindowSeconds(value: unknown): DetectWindowSeconds {
  if (value === 90 || value === 120) return value;
  if (value === 30) return 90;
  return DEFAULT_DETECT_WINDOW_SECONDS;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Keep the newest segments up to maxWords. Always keeps at least the last segment. */
export function capFromEndByWords(segments: WindowSegment[], maxWords = DETECT_MAX_WORDS): WindowSegment[] {
  if (segments.length === 0) return segments;
  let words = 0;
  let start = segments.length - 1;
  for (let i = segments.length - 1; i >= 0; i--) {
    const n = wordCount(segments[i].text);
    if (i !== segments.length - 1 && words + n > maxWords) break;
    words += n;
    start = i;
  }
  return segments.slice(start);
}

/**
 * Earliest numbered choice key where cumulative probability from segment 1 reaches tau.
 * Ignores `none`. Returns null if the mass never reaches tau (too uncertain / no question).
 */
export function earliestCumulativeStart(
  probabilities: Record<string, number> | undefined,
  orderedKeys: string[],
  tau = CUMULATIVE_START_TAU,
): string | null {
  if (!probabilities || orderedKeys.length === 0) return null;
  let cum = 0;
  for (const key of orderedKeys) {
    const p = Number(probabilities[key]);
    if (Number.isFinite(p)) cum += p;
    if (cum >= tau) return key;
  }
  return null;
}

/** Longer of the configured window and “since last answered”, capped at 3 minutes. Never shortens the end. */
export function generousCutoffMs(
  nowMs: number,
  windowSeconds: number,
  lastAnsweredAtMs?: number | null,
): number {
  const windowStart = nowMs - windowSeconds * 1000;
  const floor = nowMs - MAX_EXTRACT_BACK_MS;
  if (lastAnsweredAtMs == null || lastAnsweredAtMs <= 0) return Math.max(windowStart, floor);
  return Math.max(Math.min(windowStart, lastAnsweredAtMs), floor);
}

export function segmentsAfterCutoff(segments: WindowSegment[], cutoffMs: number): WindowSegment[] {
  return segments.filter((s) => {
    if (!s.timestamp) return true;
    const t = Date.parse(s.timestamp);
    return Number.isNaN(t) || t >= cutoffMs;
  });
}

/** Keep from the suggested start through the latest segment. Never drop the tail. */
export function sliceFromQuestionStart(segments: WindowSegment[], startIndex: number | null | undefined): WindowSegment[] {
  if (startIndex == null || !Number.isFinite(startIndex)) return segments;
  const i = segments.findIndex((s) => s.index === startIndex);
  if (i <= 0) return segments;
  return segments.slice(i);
}

export function joinSegmentText(segments: WindowSegment[]): string {
  return segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join('\n');
}
