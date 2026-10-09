/**
 * TypeSafe Jev HTTP adapter.
 * Contract: https://docs.typesafe.ai/api.md
 */
export const TYPESAFE_SYSTEMONE_URL = 'https://api.typesafe.ai/v1/systemone';

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

export async function evaluateSystemOne(
  apiKey: string,
  payload: { state: unknown; model: string; questions: Record<string, SystemOneQuestion> },
  fetchImpl: typeof fetch = fetch,
): Promise<SystemOneResponse> {
  const res = await fetchImpl(TYPESAFE_SYSTEMONE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new TypesafeHttpError(`TypeSafe HTTP ${res.status}`, res.status, text.slice(0, 800));
  }
  return JSON.parse(text) as SystemOneResponse;
}

export function isTransientTypesafeStatus(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}
