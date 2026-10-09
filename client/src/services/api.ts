export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, { credentials: 'include', ...init });
  return res;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  const text = await res.text();
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

export function fetchSpeechToken(): Promise<SpeechToken> {
  return apiJson<SpeechToken>('/api/speech-token');
}

export function translateText(text: string, to: string[], from?: string): Promise<{ translations: string[]; provider: string }> {
  return apiJson('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, to, from }),
  });
}

export type GeminiToken = {
  token: string;
  expireTime: string;
  model: string;
  mode: 'transcribe' | 'translate';
  wsUrl: string;
  proxyUrl: string;
};

export function fetchGeminiToken(mode: 'transcribe' | 'translate', targetLanguage?: string): Promise<GeminiToken> {
  return apiJson<GeminiToken>('/api/gemini-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, targetLanguage }),
  });
}

export type DetectQuestionPayload = {
  segments: Array<{ index: number; text: string; timestamp?: string }>;
  windowSeconds: number;
  lastAnsweredQuestion: string | null;
  threshold: number;
};

export type DetectQuestionResult = {
  detector: 'jev' | 'claude' | 'unavailable';
  shouldAnswer: boolean;
  question: string | null;
  segmentIndex: number | null;
  probabilities: { newQuestionFromOtherParty: number | null; isInterviewQuestion: number | null };
  fallbackReason?: string;
};

export function detectQuestion(payload: DetectQuestionPayload): Promise<DetectQuestionResult> {
  return apiJson<DetectQuestionResult>('/api/detect-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export type AnswerRequest = {
  conversation: string;
  question?: string;
  previousQuestion?: string;
  answerLanguage: string;
  userContext: string;
  model: string;
  force?: boolean;
};

export async function streamAnswer(
  body: AnswerRequest,
  onEvent: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const res = await apiFetch('/api/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || `Answer failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const event = part.split('\n').find((l) => l.startsWith('event: '))?.slice(7).trim();
      const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
      if (!event || !dataLine) continue;
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
      } catch {
        data = {};
      }
      onEvent(event, data);
    }
  }
}

export function fetchPublicConfig(): Promise<{ defaultAnswerModel: string; models: string[] }> {
  return apiJson('/api/config');
}
