import type { WorkerEnv } from '../worker/src/env';

export function mockEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    AZURE_SPEECH_REGION: 'eastasia',
    AZURE_TRANSLATOR_REGION: 'eastasia',
    ACCESS_AUD: 'test-aud',
    ACCESS_TEAM_DOMAIN: 'https://eugnel.cloudflareaccess.com',
    SKIP_ACCESS_CHECK: 'true',
    DEFAULT_ANSWER_MODEL: 'claude-opus-5-5',
    GEMINI_TRANSLATE_MODEL: 'gemini-3.5-flash-lite',
    GEMINI_LIVE_TRANSCRIBE_MODEL: 'gemini-3.5-transcribe-live',
    GEMINI_LIVE_TRANSLATE_MODEL: 'gemini-3.5-live-translate-preview',
    TYPESAFE_MODEL: 'jev-latest',
    ASSETS: { fetch: async () => new Response('asset') } as unknown as WorkerEnv['ASSETS'],
    ...overrides,
  };
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function textResponse(text: string, status = 200): Response {
  return new Response(text, { status });
}

export function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as typeof fetch;
}
