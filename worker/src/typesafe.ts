/**
 * TypeSafe Jev HTTP adapter.
 * Contract: https://docs.typesafe.ai/api.md
 */
export const TYPESAFE_SYSTEMONE_URL = 'https://api.typesafe.ai/v1/systemone';
export const TYPESAFE_TIMEOUT_MS = 3000;
export const TYPESAFE_RETRIES = 1;

export type NoulQuestion = {
  type: 'noul';
  instructions: string | Record<string, unknown>;
  criteria?: { true?: string; false?: string };
};

export type ChoiceQuestion = {
  type: 'choice';
  instructions: string | Record<string, unknown>;
  criteria: Record<string, string | null>;
};

export type SystemOneQuestion = NoulQuestion | ChoiceQuestion;

export type NoulAnswer = { type: 'noul'; noul: number };
export type ChoiceAnswer = {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type SystemOneResponse = {
  model: string;
  answers: Record<string, NoulAnswer | ChoiceAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
};

export class TypesafeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export class TypesafeTimeoutError extends Error {
  readonly status = 0;
  constructor(message = 'TypeSafe timeout') {
    super(message);
    this.name = 'TypesafeTimeoutError';
  }
}

export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  return name === 'TypesafeTimeoutError' || name === 'TimeoutError' || name === 'AbortError';
}

export async function evaluateSystemOne(
  apiKey: string,
  payload: { state: unknown; model: string; questions: Record<string, SystemOneQuestion> },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = TYPESAFE_TIMEOUT_MS,
  retries = TYPESAFE_RETRIES,
): Promise<SystemOneResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await evaluateOnce(apiKey, payload, fetchImpl, timeoutMs);
    } catch (err) {
      lastErr = err;
      const status = err instanceof TypesafeHttpError ? err.status : 0;
      const retryable = isTimeoutError(err) || isTransientTypesafeStatus(status) || status === 0;
      if (!retryable || attempt === retries) throw err;
    }
  }
  throw lastErr;
}

async function evaluateOnce(
  apiKey: string,
  payload: { state: unknown; model: string; questions: Record<string, unknown> },
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<SystemOneResponse> {
  const ac = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutP = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      ac.abort();
      reject(new TypesafeTimeoutError());
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetchImpl(TYPESAFE_SYSTEMONE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: ac.signal,
      }),
      timeoutP,
    ]);
    const text = await res.text();
    if (!res.ok) {
      throw new TypesafeHttpError(`TypeSafe HTTP ${res.status}`, res.status, text.slice(0, 800));
    }
    return JSON.parse(text) as SystemOneResponse;
  } catch (err) {
    if (isTimeoutError(err) || (err instanceof Error && err.name === 'AbortError')) {
      throw new TypesafeTimeoutError();
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function isTransientTypesafeStatus(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}
