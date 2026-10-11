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
    };

export function planAutoAnswer(opts: {
  windowSegments: WindowSegment[];
  /** Null = Jev start unavailable → keep the full 90–120s window (err longer). */
  startIndex: number | null;
  hintText: string;
  lastAnswered: string | null;
  lastHint?: string | null;
  lastConversation?: string | null;
}): AutoAnswerPlan {
  const sliced = sliceFromQuestionStart(opts.windowSegments, opts.startIndex);
  const conversation = joinSegmentText(sliced);
  if (!conversation.trim()) return { skip: true, reason: 'empty' };

  const hint =
    opts.hintText.trim() ||
    sliced.find((s) => s.index === opts.startIndex)?.text.trim() ||
    sliced[0]?.text.trim() ||
    conversation;

  const prevConv = opts.lastConversation ? normalizeQuestion(opts.lastConversation) : '';
  const curConv = normalizeQuestion(conversation);
  const sameWindow = Boolean(prevConv && (curConv === prevConv || prevConv.includes(curConv)));

  if (
    sameQuestion(opts.lastAnswered, hint) ||
    sameQuestion(opts.lastAnswered, conversation) ||
    sameQuestion(opts.lastHint, hint) ||
    sameWindow
  ) {
    return { skip: true, reason: 'repeat' };
  }

  return { skip: false, conversation, extractQuestion: true, hint, startIndex: opts.startIndex };
}
