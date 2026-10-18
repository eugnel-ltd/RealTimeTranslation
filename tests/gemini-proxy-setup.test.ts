import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { geminiLiveSetup } from '../shared/geminiLive';
import { geminiLiveSession, handleGeminiLiveProxy, type WsPeer } from '../worker/src/gemini';
import type { WorkerEnv } from '../worker/src/env';
import { mockEnv } from './helpers';

class Peer extends EventTarget implements WsPeer {
  sent: string[] = [];
  closes: Array<{ code: number; reason: string }> = [];
  accepted = false;
  send(value: string) { this.sent.push(value); }
  accept() { this.accepted = true; }
  close(code = 1000, reason = '') {
    this.closes.push({ code, reason });
    this.dispatchEvent(Object.assign(new Event('close'), { code, reason }));
  }
  frame(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data })); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 60; i++) await Promise.resolve(); }
const NativeResponse = globalThis.Response;
class UpgradeResponse extends NativeResponse {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(init?.status === 101 ? null : body, init?.status === 101 ? { status: 200 } : init);
    if (init?.status === 101) {
      Object.defineProperty(this, 'status', { value: 101 });
      Object.defineProperty(this, 'webSocket', { value: init.webSocket });
    }
  }
}
const unsafeSetup = { setup: {
  model: 'models/client-selected-model',
  generationConfig: { responseModalities: ['AUDIO'], maxOutputTokens: 8192 },
  systemInstruction: { parts: [{ text: 'Client-selected instruction' }] },
} };
const audio = JSON.stringify({ realtimeInput: { audio: { data: 'AA==', mimeType: 'audio/pcm;rate=16000' } } });
let pairs: Array<[Peer, Peer]>;
let upstream: Peer;
let fetcher: ReturnType<typeof vi.fn<() => Promise<Response>>>;
let env: WorkerEnv;

beforeEach(() => {
  pairs = []; upstream = new Peer();
  env = mockEnv({ GEMINI_API_KEY: 'gkey', GEMINI_LIVE_TRANSCRIBE_MODEL: 'server-transcribe', GEMINI_LIVE_TRANSLATE_MODEL: 'server-translate' });
  vi.stubGlobal('Response', UpgradeResponse);
  vi.stubGlobal('WebSocketPair', class {
    0: Peer; 1: Peer;
    constructor() { const pair: [Peer, Peer] = [new Peer(), new Peer()]; pairs.push(pair); this[0] = pair[0]; this[1] = pair[1]; }
  });
  fetcher = vi.fn(async () => ({ webSocket: upstream } as unknown as Response));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function open(query = '?mode=transcribe') {
  const response = await handleGeminiLiveProxy(new Request(`https://rtt.example.test/api/gemini-live${query}`, { headers: { Upgrade: 'websocket' } }), env);
  expect(response.status).toBe(101);
  return pairs[0][1];
}
function expectRejected(local: Peer) {
  expect(local.closes.length, 'invalid setup/reconfiguration must close the local peer').toBe(1);
  expect(upstream.closes.length, 'invalid setup/reconfiguration must close the paid upstream peer').toBe(1);
  expect(local.closes[0].code).toBe(1008);
  expect(upstream.closes[0].code).toBe(1008);
}

it.each([
  '?mode=unknown', '?mode=', '?mode=transcribe&mode=translate',
  '?mode=transcribe&mode=transcribe', '?mode=translate&target=en&target=yue',
])('refuses invalid or ambiguous session query %s before socket allocation or upstream work', async (query) => {
  const response = await handleGeminiLiveProxy(new Request(`https://rtt.example.test/api/gemini-live${query}`, { headers: { Upgrade: 'websocket' } }), env);
  expect(response.status, 'an invalid query must be rejected before a paid WebSocket is opened').toBe(400);
  expect(pairs).toHaveLength(0); expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  { mode: 'transcribe' as const, target: 'en' },
  { mode: 'translate' as const, target: 'yue' },
  { mode: 'translate' as const, target: 'fr-FR' },
])('replaces all first-frame client settings with captured server $mode/$target configuration', async ({ mode, target }) => {
  const expected = geminiLiveSession(env, mode, target).setup;
  const local = await open(`?mode=${mode}&target=${target}`);
  local.frame(JSON.stringify(unsafeSetup)); await flush();
  expect(upstream.sent, 'the client must not choose model, output mode, token limit or instruction').toEqual([JSON.stringify({ setup: expected })]);
  expect(local.closes).toEqual([]);
});

it('captures the default server setup once before awaiting the upstream handshake', async () => {
  let reads = 0;
  let configured = 'captured-server-model';
  Object.defineProperty(env, 'GEMINI_LIVE_TRANSCRIBE_MODEL', { get: () => { reads++; return configured; } });
  const pending = deferred<Response>(); fetcher.mockReturnValueOnce(pending.promise);
  const connecting = handleGeminiLiveProxy(new Request('https://rtt.example.test/api/gemini-live', { headers: { Upgrade: 'websocket' } }), env);
  expect(reads, 'configuration must be captured before the async upstream handshake').toBe(1);
  configured = 'later-environment-model';
  pending.resolve({ webSocket: upstream } as unknown as Response); await connecting;
  pairs[0][1].frame(JSON.stringify(unsafeSetup)); await flush();
  expect(reads).toBe(1);
  expect(upstream.sent).toEqual([JSON.stringify({ setup: geminiLiveSetup('transcribe', 'captured-server-model') })]);
});

it.each([
  'not-json', 'null', '[]', '{}', '{"setup":null}', '{"setup":"bad"}',
  JSON.stringify({ setup: {}, realtimeInput: { audioStreamEnd: true } }), audio,
])('refuses a malformed or mixed first frame %s without forwarding any client bytes', async (first) => {
  const local = await open(); local.frame(first); await flush();
  expectRejected(local); expect(upstream.sent).toEqual([]);
});

it.each(['text', 'Blob', 'ArrayBuffer', 'view'])('enforces server setup after decoding the first %s JSON frame', async (kind) => {
  const local = await open(); const bytes = new TextEncoder().encode(JSON.stringify(unsafeSetup));
  local.frame(kind === 'Blob' ? new Blob([bytes]) : kind === 'ArrayBuffer' ? bytes.buffer : kind === 'view' ? bytes : JSON.stringify(unsafeSetup));
  await flush();
  expect(upstream.sent).toEqual([JSON.stringify({ setup: geminiLiveSession(env, 'transcribe').setup })]);
});

it.each(['text', 'Blob', 'ArrayBuffer', 'view', 'null setup', 'mixed audio'])('refuses later %s setup without forwarding it or queued audio', async (kind) => {
  const local = await open(); local.frame(JSON.stringify({ setup: {} })); await flush();
  const first = upstream.sent[0];
  const payload = kind === 'null setup' ? '{"setup":null}' : kind === 'mixed audio'
    ? JSON.stringify({ setup: {}, realtimeInput: { audioStreamEnd: true } }) : JSON.stringify(unsafeSetup);
  const bytes = new TextEncoder().encode(payload);
  local.frame(kind === 'Blob' ? new Blob([bytes]) : kind === 'ArrayBuffer' ? bytes.buffer : kind === 'view' ? bytes : payload);
  local.frame(audio); await flush();
  expectRejected(local); expect(upstream.sent).toEqual([first]);
});

it('serializes a delayed Blob reconfiguration before queued audio and suppresses all work after rejection', async () => {
  const local = await open(); local.frame(JSON.stringify({ setup: {} })); await flush(); const first = upstream.sent[0];
  const decoded = deferred<string>();
  class DelayedBlob extends Blob { override text() { return decoded.promise; } }
  local.frame(new DelayedBlob()); local.frame(audio); await flush();
  expect(upstream.sent).toEqual([first]);
  decoded.resolve(JSON.stringify(unsafeSetup)); await flush();
  expectRejected(local); expect(upstream.sent).toEqual([first]);
});

it('preserves browser setup/audio/ack/end messages and upstream close reasons', async () => {
  const local = await open('?mode=translate&target=zh-HK');
  local.frame(JSON.stringify({ setup: geminiLiveSetup('translate', 'browser-model', 'zh-HK') })); await flush();
  const ack = '{"setupComplete":{}}'; upstream.frame(new Blob([ack])); await flush();
  expect(local.sent).toEqual([ack]);
  local.frame(audio); const end = '{"realtimeInput":{"audioStreamEnd":true}}'; local.frame(end); await flush();
  expect(upstream.sent.slice(1)).toEqual([audio, end]);
  upstream.close(1007, 'invalid payload'); expect(local.closes).toEqual([{ code: 1007, reason: 'invalid payload' }]);
});

it('keeps a local clean stop and drops a first Blob that resolves after closing', async () => {
  const local = await open(); const decoded = deferred<string>();
  class DelayedBlob extends Blob { override text() { return decoded.promise; } }
  local.frame(new DelayedBlob()); await flush(); local.close(1000, 'client stop');
  decoded.resolve(JSON.stringify(unsafeSetup)); await flush();
  expect(upstream.closes).toEqual([{ code: 1000, reason: 'client stop' }]); expect(upstream.sent).toEqual([]);
});

it('refuses malformed post-setup JSON and closes both peers', async () => {
  const local = await open(); local.frame(JSON.stringify({ setup: {} })); await flush(); const first = upstream.sent[0];
  local.frame('not-json'); await flush(); expectRejected(local); expect(upstream.sent).toEqual([first]);
});

it('retains missing-key and non-upgrade failures without opening upstream', async () => {
  const missing = await handleGeminiLiveProxy(new Request('https://rtt.example.test/api/gemini-live', { headers: { Upgrade: 'websocket' } }), mockEnv());
  const plain = await handleGeminiLiveProxy(new Request('https://rtt.example.test/api/gemini-live'), env);
  expect(missing.status).toBe(503); expect(plain.status).toBe(426);
  expect(pairs).toHaveLength(0); expect(fetcher).not.toHaveBeenCalled();
});
