import { joinSegmentText, sliceFromQuestionStart, type WindowSegment } from './extractWindow';

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Equality, or a long fragment contained in the other (hint vs extracted full question). */
export function sameQuestion(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizeQuestion(a);
  const nb = normalizeQuestion(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length < 24) return false;
  return longer.includes(shorter);
}

export type AutoAnswerPlan =
  | { skip: true; reason: 'empty' | 'repeat' }
  | {
      skip: false;
      conversation: string;
      extractQuestion: true;
      hint: string;
      startIndex: number | null;
      endIndex: number | null;
    };

/**
 * Repeat = no new speech after the last answered end id.
 * Sticky Jev starts that still point at Q(n) are clamped to lastEnd+1 when newer segments exist.
 */
export function resolveExtractStart(
  questionStartId: number | null,
  lastAnsweredEndId: number | null,
  newestId: number | null,
): number | null {
  if (newestId != null && lastAnsweredEndId != null && newestId <= lastAnsweredEndId) return questionStartId;
  if (questionStartId != null && (lastAnsweredEndId == null || questionStartId > lastAnsweredEndId)) {
    return questionStartId;
  }
  if (lastAnsweredEndId != null && newestId != null && newestId > lastAnsweredEndId) {
    return lastAnsweredEndId + 1;
  }
  return questionStartId;
}

export function isRepeatBySegmentId(newestId: number | null, lastAnsweredEndId: number | null): boolean {
  if (lastAnsweredEndId == null || newestId == null) return false;
  return newestId <= lastAnsweredEndId;
}

export function planAutoAnswer(opts: {
  windowSegments: WindowSegment[];
  /** Dedicated question-start id (absolute). */
  startIndex: number | null;
  hintText: string;
  lastAnsweredEndId?: number | null;
  lastAnsweredStartId?: number | null;
  lastAnswered?: string | null;
  lastHint?: string | null;
  lastConversation?: string | null;
}): AutoAnswerPlan {
  const newestId = opts.windowSegments.at(-1)?.index ?? null;
  if (isRepeatBySegmentId(newestId, opts.lastAnsweredEndId ?? null)) {
    return { skip: true, reason: 'repeat' };
  }

  const start = resolveExtractStart(opts.startIndex, opts.lastAnsweredEndId ?? null, newestId);
  const sliced = sliceFromQuestionStart(opts.windowSegments, start);
  const conversation = joinSegmentText(sliced);
  if (!conversation.trim()) return { skip: true, reason: 'empty' };

  const newestText = opts.windowSegments.at(-1)?.text.trim() || '';
  const startText = sliced.find((s) => s.index === start)?.text.trim() || '';
  const hint = opts.hintText.trim() || newestText || startText || conversation;

  return {
    skip: false,
    conversation,
    extractQuestion: true,
    hint,
    startIndex: start,
    endIndex: newestId,
  };
}
