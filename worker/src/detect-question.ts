import type { WorkerEnv } from './env';
import { json, log, logError, readJson } from './http';
import {
  evaluateSystemOne,
  isTransientTypesafeStatus,
  TypesafeHttpError,
  type ChoiceAnswer,
  type NoulAnswer,
  type SystemOneQuestion,
} from './typesafe';

export type DetectSegment = {
  index: number;
  text: string;
  timestamp?: string;
};

export type DetectQuestionBody = {
  segments?: DetectSegment[];
  windowSeconds?: number;
  lastAnsweredQuestion?: string | null;
  threshold?: number;
};

export type DetectQuestionResult = {
  detector: 'jev' | 'claude' | 'unavailable';
  shouldAnswer: boolean;
  question: string | null;
  segmentIndex: number | null;
  probabilities: {
    newQuestionFromOtherParty: number | null;
    isInterviewQuestion: number | null;
  };
  fallbackReason?: string;
};

const JEV_COOLDOWN_MS = 5 * 60 * 1000;
let jevUnavailableUntil = 0;

export function resetJevCooldown(): void {
  jevUnavailableUntil = 0;
}

export function setJevCooldown(until: number): void {
  jevUnavailableUntil = until;
}

function jevCoolingDown(now = Date.now()): boolean {
  return now < jevUnavailableUntil;
}

function markJevCooldown(now = Date.now()): void {
  jevUnavailableUntil = now + JEV_COOLDOWN_MS;
}

export async function handleDetectQuestion(
  request: Request,
  env: WorkerEnv,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<Response> {
  const body = await readJson<DetectQuestionBody>(request);
  const segments = (body.segments ?? []).filter((s) => s.text?.trim());
  if (segments.length === 0) {
    return json({
      detector: 'unavailable',
      shouldAnswer: false,
      question: null,
      segmentIndex: null,
      probabilities: { newQuestionFromOtherParty: null, isInterviewQuestion: null },
      fallbackReason: 'empty_segments',
    } satisfies DetectQuestionResult);
  }

  const threshold = clampThreshold(body.threshold);
  const lastAnswered = body.lastAnsweredQuestion?.trim() || '';

  if (env.TYPESAFE_API_KEY && !jevCoolingDown(now)) {
    try {
      const result = await detectWithJev(env, segments, lastAnswered, threshold, body.windowSeconds, fetchImpl);
      return json(result);
    } catch (err) {
      const status = err instanceof TypesafeHttpError ? err.status : 0;
      if (status === 401 || status === 403) {
        logError({ message: 'jev auth failed', status });
        return json(await detectWithClaudeOrEmpty(env, segments, lastAnswered, 'jev_auth', fetchImpl));
      }
      if (isTransientTypesafeStatus(status) || status === 0) {
        markJevCooldown(now);
        log({ message: 'jev cooldown started', status, minutes: 5 });
        return json(await detectWithClaudeOrEmpty(env, segments, lastAnswered, 'jev_transient', fetchImpl));
      }
      logError({ message: 'jev unexpected error', error: err instanceof Error ? err.message : String(err) });
      return json(await detectWithClaudeOrEmpty(env, segments, lastAnswered, 'jev_error', fetchImpl));
    }
  }

  const reason = !env.TYPESAFE_API_KEY ? 'typesafe_unconfigured' : 'jev_cooldown';
  return json(await detectWithClaudeOrEmpty(env, segments, lastAnswered, reason, fetchImpl));
}

function clampThreshold(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.7;
  return Math.min(0.95, Math.max(0.5, value));
}

export function buildJevPayload(
  segments: DetectSegment[],
  lastAnswered: string,
  windowSeconds: number | undefined,
  model: string,
): { state: unknown; model: string; questions: Record<string, SystemOneQuestion> } {
  const capped = segments.slice(-20);
  const criteria: Record<string, string | null> = { none: 'No interviewer question the candidate should answer.' };
  for (const seg of capped) {
    criteria[String(seg.index)] = seg.text.slice(0, 500);
  }

  return {
    model,
    state: {
      setting:
        'Live job interview. The candidate is using this app. Segments are chronological speech from the room; speakers are not labelled.',
      window_seconds: windowSeconds ?? 60,
      segments: capped.map((s) => ({
        index: String(s.index),
        timestamp: s.timestamp ?? '',
        text: s.text,
      })),
      latest_segment_index: String(capped[capped.length - 1]?.index ?? 0),
      already_answered_question: lastAnswered || null,
    },
    questions: {
      new_question_from_other_party: {
        type: 'noul',
        instructions:
          'Did the other party (the interviewer, not the candidate) ask a question in `segments` that is not the same as `already_answered_question`? If `already_answered_question` is null, treat any interviewer question as new. Candidate self-talk, clarification, or repeating the already-answered question is not a new interviewer question.',
        criteria: {
          true: 'A new interviewer question is present in the window.',
          false: 'No new interviewer question (small talk, candidate speech, repeat, or incomplete utterance).',
        },
      },
      is_interview_question: {
        type: 'noul',
        instructions:
          'Is the newest question from the other party an interview question the candidate should answer (role, experience, technical, behavioural, case), rather than greeting, logistics, or acknowledgement?',
        criteria: {
          true: 'The candidate is expected to answer this as an interview question.',
          false: 'Not an interview question, or there is no question.',
        },
      },
      question_segment: {
        type: 'choice',
        instructions:
          'Which `segments[i].text` contains the newest interviewer question the candidate should answer? Choose none if there is no such question. Prefer the latest complete question if several exist.',
        criteria,
      },
    },
  };
}

async function detectWithJev(
  env: WorkerEnv,
  segments: DetectSegment[],
  lastAnswered: string,
  threshold: number,
  windowSeconds: number | undefined,
  fetchImpl: typeof fetch,
): Promise<DetectQuestionResult> {
  const payload = buildJevPayload(segments, lastAnswered, windowSeconds, env.TYPESAFE_MODEL || 'jev-latest');
  const response = await evaluateSystemOne(env.TYPESAFE_API_KEY as string, payload, fetchImpl);
  const newQ = response.answers.new_question_from_other_party as NoulAnswer | undefined;
  const interview = response.answers.is_interview_question as NoulAnswer | undefined;
  const choice = response.answers.question_segment as ChoiceAnswer | undefined;
  const newP = typeof newQ?.noul === 'number' ? newQ.noul : 0;
  const interviewP = typeof interview?.noul === 'number' ? interview.noul : 0;
  const selected = choice?.choice ?? 'none';
  const segmentIndex = selected === 'none' ? null : Number(selected);
  const hit = segments.find((s) => s.index === segmentIndex);
  const shouldAnswer = newP >= threshold && interviewP >= threshold && hit != null;
  return {
    detector: 'jev',
    shouldAnswer,
    question: shouldAnswer ? hit.text.trim() : null,
    segmentIndex: shouldAnswer ? segmentIndex : null,
    probabilities: {
      newQuestionFromOtherParty: newP,
      isInterviewQuestion: interviewP,
    },
  };
}

async function detectWithClaudeOrEmpty(
  env: WorkerEnv,
  segments: DetectSegment[],
  lastAnswered: string,
  fallbackReason: string,
  fetchImpl: typeof fetch,
): Promise<DetectQuestionResult> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      detector: 'unavailable',
      shouldAnswer: false,
      question: null,
      segmentIndex: null,
      probabilities: { newQuestionFromOtherParty: null, isInterviewQuestion: null },
      fallbackReason,
    };
  }
  try {
    const result = await detectWithClaude(env, segments, lastAnswered, fetchImpl);
    return { ...result, fallbackReason };
  } catch (err) {
    logError({ message: 'claude detect failed', error: err instanceof Error ? err.message : String(err) });
    return {
      detector: 'unavailable',
      shouldAnswer: false,
      question: null,
      segmentIndex: null,
      probabilities: { newQuestionFromOtherParty: null, isInterviewQuestion: null },
      fallbackReason: `${fallbackReason}+claude_error`,
    };
  }
}

async function detectWithClaude(
  env: WorkerEnv,
  segments: DetectSegment[],
  lastAnswered: string,
  fetchImpl: typeof fetch,
): Promise<DetectQuestionResult> {
  const numbered = segments.map((s) => `[${s.index}] ${s.text}`).join('\n');
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.DEFAULT_ANSWER_MODEL || 'claude-opus-5-5',
      max_tokens: 256,
      output_config: { effort: 'low' },
      system:
        'Return JSON only with keys question (string|null), segment_index (number|null), is_new (boolean), is_interview_question (boolean). Extract the newest interviewer question for a live job interview.',
      messages: [
        {
          role: 'user',
          content: `already_answered_question: ${JSON.stringify(lastAnswered || null)}\nsegments:\n${numbered}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`anthropic ${res.status}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
  const parsed = JSON.parse(extractJson(text)) as {
    question?: string | null;
    segment_index?: number | null;
    is_new?: boolean;
    is_interview_question?: boolean;
  };
  const question = parsed.question?.trim() || null;
  const shouldAnswer = Boolean(parsed.is_new && parsed.is_interview_question && question);
  return {
    detector: 'claude',
    shouldAnswer,
    question: shouldAnswer ? question : null,
    segmentIndex: typeof parsed.segment_index === 'number' ? parsed.segment_index : null,
    probabilities: {
      newQuestionFromOtherParty: parsed.is_new ? 1 : 0,
      isInterviewQuestion: parsed.is_interview_question ? 1 : 0,
    },
  };
}

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no json');
  return text.slice(start, end + 1);
}
