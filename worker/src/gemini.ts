import { geminiLiveSetup, type GeminiLiveMode } from '../../shared/geminiLive';
import type { WorkerEnv } from './env';
import { errorJson, json, logError, readJson } from './http';

const AUTH_TOKENS_URL = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';
const LIVE_CONSTRAINED =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const LIVE_UPSTREAM =
  'https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export type GeminiMode = GeminiLiveMode;

export type GeminiTokenBody = {
  mode?: GeminiMode;
  targetLanguage?: string;
};

export type WsPeer = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
};

export function geminiLiveSession(
  env: WorkerEnv,
  mode: GeminiMode,
  targetLanguage?: string,
): { model: string; setup: Record<string, unknown> } {
  const model =
    mode === 'translate'
      ? env.GEMINI_LIVE_TRANSLATE_MODEL || 'gemini-3.5-live-translate-preview'
      : env.GEMINI_LIVE_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe-live';
  return { model, setup: geminiLiveSetup(mode, model, targetLanguage || 'en') };
}

export async function wsDataToText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  if (data && typeof data === 'object' && typeof (data as Blob).text === 'function') {
    return (data as Blob).text();
  }
  if (data && typeof data === 'object' && typeof (data as ArrayBufferView).buffer !== 'undefined') {
    const view = data as ArrayBufferView;
    return new TextDecoder().decode(view);
  }
  return String(data);
}

export function forwardCloseCode(code: number | undefined): number {
  if (!code || code === 1005 || code === 1006) return 1000;
  return code;
}

export function attachGeminiProxy(local: WsPeer, remote: WsPeer): void {
  let closed = false;

  const sendText = async (dest: WsPeer, data: unknown) => {
    try {
      dest.send(await wsDataToText(data));
    } catch {
      /* closed */
    }
  };

  const closePeer = (dest: WsPeer, event: { code?: number; reason?: string }) => {
    if (closed) return;
    closed = true;
    try {
      dest.close(forwardCloseCode(event.code), event.reason ?? '');
    } catch {
      /* ignore */
    }
  };

  local.addEventListener('message', (event) => {
    void sendText(remote, (event as MessageEvent).data);
  });
  remote.addEventListener('message', (event) => {
    void sendText(local, (event as MessageEvent).data);
  });
  local.addEventListener('close', (event) => closePeer(remote, event as CloseEvent));
  remote.addEventListener('close', (event) => closePeer(local, event as CloseEvent));
  local.addEventListener('error', () => closePeer(remote, { code: 1011, reason: 'local error' }));
  remote.addEventListener('error', () => closePeer(local, { code: 1011, reason: 'remote error' }));
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

  const { model, setup } = geminiLiveSession(env, mode, targetLanguage);
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
      bidiGenerateContentSetup: setup,
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
    attachGeminiProxy(server, gemini);
  } catch (err) {
    logError({ message: 'gemini live proxy failed', error: err instanceof Error ? err.message : String(err) });
    server.close(1011, 'proxy failed');
    return errorJson('Gemini live proxy failed', 502);
  }

  return new Response(null, { status: 101, webSocket: client });
}
