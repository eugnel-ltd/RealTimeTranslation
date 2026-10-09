import type { WorkerEnv } from './env';
import { errorJson, json, logError, readJson } from './http';
import { toGeminiLiveCode } from './languages';

const AUTH_TOKENS_URL = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';
const LIVE_CONSTRAINED =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const LIVE_UPSTREAM =
  'https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export type GeminiMode = 'transcribe' | 'translate';

export type GeminiTokenBody = {
  mode?: GeminiMode;
  targetLanguage?: string;
};

export function geminiModels(env: WorkerEnv, mode: GeminiMode): { model: string; setupConfig: Record<string, unknown> } {
  if (mode === 'translate') {
    return {
      model: env.GEMINI_LIVE_TRANSLATE_MODEL || 'gemini-3.5-live-translate-preview',
      setupConfig: {
        responseModalities: ['AUDIO'],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        translationConfig: {
          targetLanguageCode: 'en',
          echoTargetLanguage: false,
        },
      },
    };
  }
  return {
    model: env.GEMINI_LIVE_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe-live',
    setupConfig: {
      responseModalities: ['TEXT'],
      inputAudioTranscription: { languageCodes: [] },
    },
  };
}

export async function handleGeminiToken(
  request: Request,
  env: WorkerEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!env.GEMINI_API_KEY) return errorJson('GEMINI_API_KEY is not configured', 503);

  const url = new URL(request.url);
  let mode = (url.searchParams.get('mode') as GeminiMode | null) ?? 'transcribe';
  let targetLanguage = url.searchParams.get('target') ?? undefined;
  if (request.method === 'POST') {
    const body = await readJson<GeminiTokenBody>(request).catch(() => ({}) as GeminiTokenBody);
    mode = body.mode ?? mode;
    targetLanguage = body.targetLanguage ?? targetLanguage;
  }
  if (mode !== 'transcribe' && mode !== 'translate') {
    return errorJson('mode must be transcribe or translate', 400);
  }

  const { model, setupConfig } = geminiModels(env, mode);
  if (mode === 'translate') {
    const cfg = setupConfig as {
      translationConfig: { targetLanguageCode: string; echoTargetLanguage: boolean };
    };
    cfg.translationConfig.targetLanguageCode = toGeminiLiveCode(targetLanguage || 'en');
  }

  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

  const res = await fetchImpl(AUTH_TOKENS_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': env.GEMINI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uses: 2,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: {
        model: `models/${model}`,
        config: setupConfig,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    logError({ message: 'gemini auth_tokens failed', status: res.status, body: errBody.slice(0, 400) });
    return errorJson('Failed to mint Gemini ephemeral token', 502, { status: res.status });
  }

  const data = (await res.json()) as { name?: string; token?: string };
  const token = data.name || data.token;
  if (!token) return errorJson('Gemini token response missing name', 502);

  return json({
    token,
    expireTime,
    model,
    mode,
    wsUrl: `${LIVE_CONSTRAINED}?access_token=${encodeURIComponent(token)}`,
    proxyUrl: `/api/gemini-live?mode=${mode}${targetLanguage ? `&target=${encodeURIComponent(targetLanguage)}` : ''}`,
  });
}

export async function handleGeminiLiveProxy(request: Request, env: WorkerEnv): Promise<Response> {
  if (!env.GEMINI_API_KEY) return errorJson('GEMINI_API_KEY is not configured', 503);
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  const upstream = `${LIVE_UPSTREAM}?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  try {
    const res = await fetch(upstream, { headers: { Upgrade: 'websocket' } });
    const gemini = res.webSocket;
    if (!gemini) {
      server.close(1011, 'Gemini WebSocket unavailable');
      return errorJson('Gemini WebSocket upgrade failed', 502);
    }
    gemini.accept();
    server.addEventListener('message', (event) => {
      try {
        gemini.send(event.data);
      } catch {
        /* closed */
      }
    });
    gemini.addEventListener('message', (event) => {
      try {
        server.send(event.data);
      } catch {
        /* closed */
      }
    });
    const closeBoth = () => {
      try {
        server.close();
      } catch {
        /* ignore */
      }
      try {
        gemini.close();
      } catch {
        /* ignore */
      }
    };
    server.addEventListener('close', closeBoth);
    gemini.addEventListener('close', closeBoth);
    server.addEventListener('error', closeBoth);
    gemini.addEventListener('error', closeBoth);
  } catch (err) {
    logError({ message: 'gemini live proxy failed', error: err instanceof Error ? err.message : String(err) });
    server.close(1011, 'proxy failed');
    return errorJson('Gemini live proxy failed', 502);
  }

  return new Response(null, { status: 101, webSocket: client });
}
