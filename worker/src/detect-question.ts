import {
  capFromEndByWords,
  CUMULATIVE_START_TAU,
  DEFAULT_DETECT_WINDOW_SECONDS,
  DEFAULT_QUESTION_THRESHOLD,
  DETECT_MAX_WORDS,
  earliestCumulativeStart,
  MAX_QUESTION_THRESHOLD,
  MIN_QUESTION_THRESHOLD,
} from '../../shared/extractWindow';
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

export type DetectMode = 'auto' | 'question-start';

export type DetectQuestionBody = {
  segments?: DetectSegment[];
  windowSeconds?: number;
  lastAnsweredQuestion?: string | null;
  threshold?: number;
  mode?: DetectMode;
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

/** Short pause after Jev timeout/transient. Do not fall back to Opus on every debounce. */
const JEV_COOLDOWN_MS = 20_000;
const DETECT_FALLBACK_MODEL = 'claude-haiku-4-5';
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
  const mode: DetectMode = body.mode === 'question-start' ? 'question-start' : 'auto';

  if (env.TYPESAFE_API_KEY && !jevCoolingDown(now)) {
    try {
      const result = await detectWithJev(env, segments, lastAnswered, threshold, body.windowSeconds, fetchImpl, mode);
      return json(result);
    } catch (err) {
      const status = err instanceof TypesafeHttpError ? err.status : 0;
      if (status === 401 || status === 403) {
        logError({ message: 'jev auth failed', status });
        return json(pauseDetect(mode, 'jev_auth'));
      }
      if (isTransientTypesafeStatus(status) || status === 0) {
        markJevCooldown(now);
        log({ message: 'jev cooldown started', status, ms: JEV_COOLDOWN_MS });
        return json(pauseDetect(mode, 'jev_transient'));
      }
      logError({ message: 'jev unexpected error', error: err instanceof Error ? err.message : String(err) });
      markJevCooldown(now);
      return json(pauseDetect(mode, 'jev_error'));
    }
  }

  const reason = !env.TYPESAFE_API_KEY ? 'typesafe_unconfigured' : 'jev_cooldown';
  if (reason === 'jev_cooldown' || mode === 'question-start') {
    return json(pauseDetect(mode, reason));
  }
  return json(await detectWithHaikuOrEmpty(env, segments, lastAnswered, reason, fetchImpl));
}

function pauseDetect(mode: DetectMode, fallbackReason: string): DetectQuestionResult {
  return {
    detector: 'unavailable',
    shouldAnswer: false,
    question: null,
    segmentIndex: null,
    probabilities: { newQuestionFromOtherParty: null, isInterviewQuestion: null },
    fallbackReason,
  };
}

function clampThreshold(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_QUESTION_THRESHOLD;
  return Math.min(MAX_QUESTION_THRESHOLD, Math.max(MIN_QUESTION_THRESHOLD, value));
}

const START_CHOICE_INSTRUCTIONS =
  'At which numbered segment does the CURRENT interviewer question START? Include preamble and all sub-parts. Prefer earlier over later. Choose none if there is no interviewer question.';

export function prepareDetectWindow(
  segments: DetectSegment[],
  windowSeconds: number | undefined,
): {
  capped: DetectSegment[];
  keys: string[];
  criteria: Record<string, string | null>;
  indexByKey: Record<string, number>;
  windowSeconds: number;
  transcript: string;
} {
  const capped = capFromEndByWords(segments, DETECT_MAX_WORDS);
  const keys = capped.map((_, i) => String(i + 1));
  const criteria: Record<string, string | null> = { none: 'No interviewer question in this window.' };
  const indexByKey: Record<string, number> = {};
  capped.forEach((seg, i) => {
    const key = String(i + 1);
    criteria[key] = seg.text.slice(0, 500);
    indexByKey[key] = seg.index;
  });
  return {
    capped,
    keys,
    criteria,
    indexByKey,
    windowSeconds: windowSeconds ?? DEFAULT_DETECT_WINDOW_SECONDS,
    transcript: capped.map((s, i) => `[${i + 1}] ${s.text}`).join('\n'),
  };
}

function startIndexFromChoice(
  choice: ChoiceAnswer | undefined,
  keys: string[],
  indexByKey: Record<string, number>,
): number | null {
  const key = earliestCumulativeStart(choice?.probabilities, keys, CUMULATIVE_START_TAU);
  if (key == null) return null;
  const index = indexByKey[key];
  return Number.isFinite(index) ? index : null;
}

function jevModel(env: WorkerEnv): string {
  return env.TYPESAFE_MODEL || 'jev-latest';
}

export function buildJevStartPayload(
  segments: DetectSegment[],
  lastAnswered: string,
  windowSeconds: number | undefined,
  model: string,
): { state: unknown; model: string; questions: Record<string, SystemOneQuestion> } {
  const win = prepareDetectWindow(segments, windowSeconds);
  return {
    model,
    state: {
      setting:
        'Live conversation. Find where the CURRENT interviewer question turn STARTS, including preamble and multi-part setup. Prefer the earliest segment that is still part of this question. Do not pick a later sub-part if earlier context belongs to the same question.',
      window_seconds: win.windowSeconds,
      transcript: win.transcript,
      already_answered_question: lastAnswered || null,
    },
    questions: {
      question_start_segment: {
        type: 'choice',
        instructions: START_CHOICE_INSTRUCTIONS,
        criteria: win.criteria,
      },
    },
  };
}

export function buildJevPayload(
  segments: DetectSegment[],
  lastAnswered: string,
  windowSeconds: number | undefined,
  model: string,
): { state: unknown; model: string; questions: Record<string, SystemOneQuestion> } {
  const win = prepareDetectWindow(segments, windowSeconds);
  return {
    model,
    state: {
      setting:
        'Live job interview. Numbered lines are chronological speech from the room; speakers are not labelled. The candidate is using this app.',
      window_seconds: win.windowSeconds,
      transcript: win.transcript,
      already_answered_question: lastAnswered || null,
    },
    questions: {
      has_substantive_question: {
        type: 'noul',
        instructions:
          'Has the interviewer just finished asking the candidate a substantive question that needs an answer? Treat already_answered_question as already handled. Incomplete or cut-off questions, greetings, logistics, small talk, candidate speech, and rhetorical questions the interviewer already answered are false.',
        criteria: {
          true: 'The interviewer has just finished a substantive interview question the candidate should answer, and it is not already_answered_question.',
          false:
            'No such completed question (cut off mid-sentence, small talk, candidate speaking, repeat, statement, or already answered).',
        },
      },
      question_start_segment: {
        type: 'choice',
        instructions: START_CHOICE_INSTRUCTIONS,
        criteria: win.criteria,
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
  mode: DetectMode = 'auto',
): Promise<DetectQuestionResult> {
  const win = prepareDetectWindow(segments, windowSeconds);
  const model = jevModel(env);
  if (mode === 'question-start') {
    const payload = buildJevStartPayload(segments, lastAnswered, windowSeconds, model);
    const response = await evaluateSystemOne(env.TYPESAFE_API_KEY as string, payload, fetchImpl);
    const choice = response.answers.question_start_segment as ChoiceAnswer | undefined;
    const segmentIndex = startIndexFromChoice(choice, win.keys, win.indexByKey);
    return {
      detector: 'jev',
      shouldAnswer: false,
      question: null,
      segmentIndex,
      probabilities: { newQuestionFromOtherParty: null, isInterviewQuestion: null },
    };
  }
  const payload = buildJevPayload(segments, lastAnswered, windowSeconds, model);
  const response = await evaluateSystemOne(env.TYPESAFE_API_KEY as string, payload, fetchImpl);
  const noul = response.answers.has_substantive_question as NoulAnswer | undefined;
  const choice = response.answers.question_start_segment as ChoiceAnswer | undefined;
  const p = typeof noul?.noul === 'number' ? noul.noul : 0;
  const segmentIndex = startIndexFromChoice(choice, win.keys, win.indexByKey);
  const shouldAnswer = p >= threshold;
  const newest = win.capped.at(-1);
  return {
    detector: 'jev',
    shouldAnswer,
    question: shouldAnswer ? newest?.text.trim() || null : null,
    segmentIndex,
    probabilities: {
      newQuestionFromOtherParty: p,
      isInterviewQuestion: p,
    },
  };
}

async function detectWithHaikuOrEmpty(
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
    const result = await detectWithHaiku(env, segments, lastAnswered, fetchImpl);
    return { ...result, fallbackReason };
  } catch (err) {
    logError({ message: 'haiku detect failed', error: err instanceof Error ? err.message : String(err) });
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

async function detectWithHaiku(
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
      model: DETECT_FALLBACK_MODEL,
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
