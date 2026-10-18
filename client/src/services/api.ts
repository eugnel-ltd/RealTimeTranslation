import { assertRuntime, type AppRuntime } from './accountLifetime';

export async function apiFetch(path: string, init?: RequestInit, runtime?: AppRuntime): Promise<Response> {
  assertRuntime(runtime);
  const signal = runtime ? (init?.signal ? AbortSignal.any([runtime.signal, init.signal]) : runtime.signal) : init?.signal;
  const res = await fetch(path, { credentials: 'include', ...init, signal });
  if (res.status === 401 && runtime?.accountMode !== false) runtime?.invalidate();
  assertRuntime(runtime);
  return res;
}

export async function apiJson<T>(path: string, init?: RequestInit, runtime?: AppRuntime): Promise<T> {
  const res = await apiFetch(path, init, runtime);
  const text = await res.text();
  assertRuntime(runtime);
  let data: T | { error?: string } | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: string } | null)?.error || text || res.statusText;
    throw new Error(err);
  }
  return data as T;
}

export type SpeechToken = { token: string; region: string; expiresIn: number };

export function fetchSpeechToken(runtime?: AppRuntime): Promise<SpeechToken> {
  return apiJson<SpeechToken>('/api/speech-token', undefined, runtime);
}

export function translateText(text: string, to: string[], from?: string, signal?: AbortSignal, runtime?: AppRuntime): Promise<{ translations: string[]; provider: string }> {
  return apiJson('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, to, from }),
    signal,
  }, runtime);
}

export type GeminiToken = {
  token: string;
  expireTime: string;
  model: string;
  mode: 'transcribe' | 'translate';
  wsUrl: string;
  proxyUrl: string;
};

export function fetchGeminiToken(mode: 'transcribe' | 'translate', targetLanguage?: string, runtime?: AppRuntime): Promise<GeminiToken> {
  return apiJson<GeminiToken>('/api/gemini-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, targetLanguage }),
  }, runtime);
}

export type DetectQuestionPayload = {
  segments: Array<{ index: number; text: string; timestamp?: string }>;
  windowSeconds: number;
  lastAnsweredQuestion: string | null;
  threshold: number;
  mode?: 'auto' | 'question-start';
};

export type DetectQuestionResult = {
  detector: 'jev' | 'gemini' | 'unavailable';
  shouldAnswer: boolean;
  question: string | null;
  segmentIndex: number | null;
  probabilities: { newQuestionFromOtherParty: number | null; isInterviewQuestion: number | null };
  fallbackReason?: string;
};

export function detectQuestion(payload: DetectQuestionPayload, runtime?: AppRuntime): Promise<DetectQuestionResult> {
  return apiJson<DetectQuestionResult>('/api/detect-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, runtime);
}

export type AnswerRequest = {
  conversation: string;
  question?: string;
  questionHint?: string;
  previousQuestion?: string;
  answerLanguage: string;
  userContext: string;
  extraNotes?: string;
  profileId?: string;
  model: string;
  force?: boolean;
  templateId?: string;
  extractQuestion?: boolean;
  questionTimeLimitSeconds?: number;
};

export async function streamAnswer(
  body: AnswerRequest,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  signal?: AbortSignal,
  runtime?: AppRuntime,
): Promise<void> {
  const res = await apiFetch('/api/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }, runtime);
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || `Answer failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  runtime?.signal.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  let buf = '';
  try {
    while (!signal?.aborted && (!runtime || runtime.active)) {
      const { done, value } = await reader.read();
      if (signal?.aborted || (runtime && !runtime.active)) return;
      buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const parts = buf.split(/\r?\n\r?\n/);
      buf = done ? '' : parts.pop() ?? '';
      for (const part of parts) {
        const lines = part.split(/\r?\n/);
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
        const payload = lines.filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart()).join('\n');
        if (!event || !payload) continue;
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          data = {};
        }
        if (signal?.aborted || (runtime && !runtime.active)) return;
        onEvent(event, data);
      }
      if (done) break;
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    runtime?.signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function fetchPublicConfig(runtime?: AppRuntime): Promise<{
  defaultAnswerModel: string;
  models: string[];
  templates?: Array<{ id: string; label: string }>;
}> {
  return apiJson('/api/config', undefined, runtime);
}

export type ProfileSummary = { id: 'james' | 'wing'; name: string };
export type CandidateProfile = ProfileSummary & { markdown: string };

export function listProfiles(runtime?: AppRuntime): Promise<{ profiles: ProfileSummary[] }> {
  return apiJson('/api/profiles', undefined, runtime);
}

export function getProfile(id: string, runtime?: AppRuntime): Promise<CandidateProfile> {
  return apiJson(`/api/profiles/${encodeURIComponent(id)}`, undefined, runtime);
}

export function putProfile(
  id: string,
  body: { markdown: string; name?: string },
  runtime?: AppRuntime,
): Promise<CandidateProfile & { bytes: number }> {
  return apiJson(`/api/profiles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, runtime);
}
