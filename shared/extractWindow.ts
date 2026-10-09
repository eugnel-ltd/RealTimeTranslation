export type WindowSegment = {
  index: number;
  text: string;
  timestamp?: string;
};

const MAX_EXTRACT_BACK_MS = 180_000;

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
