import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiSpeechService } from '../client/src/services/geminiSpeech';

const api = vi.hoisted(() => ({ token: vi.fn(), translate: vi.fn() }));
vi.mock('../client/src/services/api', () => ({ fetchGeminiToken: api.token, translateText: api.translate }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
let sockets: FakeSocket[];
let tracks: Array<{ stop: ReturnType<typeof vi.fn> }>;
let mic: ReturnType<typeof vi.fn>;
let audioClose: ReturnType<typeof vi.fn>;
let autoSetup: boolean;
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  sent: Array<Record<string, unknown>> = [];
  close = vi.fn(() => { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }); });
  constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
  send(raw: string) {
    const data = JSON.parse(raw);
    this.sent.push(data);
    if (data.setup && autoSetup) queueMicrotask(() => this.message({ setupComplete: {} }));
  }
  message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
function stream() {
  const track = { stop: vi.fn() };
  tracks.push(track);
  return { getTracks: () => [track] } as unknown as MediaStream;
}
const config = { inputLanguage: 'en-US', outputLanguage: 'fr' };
let callbacks: {
  onRecognizing: ReturnType<typeof vi.fn<(original: string, translations: string[], detectedLanguage?: string) => void>>;
  onRecognized: ReturnType<typeof vi.fn<(original: string, translations: string[], detectedLanguage?: string) => void>>;
  onError: ReturnType<typeof vi.fn<(message: string) => void>>;
};
let service: GeminiSpeechService;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); sockets = []; tracks = []; autoSetup = true;
  mic = vi.fn(async () => stream()); audioClose = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: mic } });
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('AudioContext', class {
    sampleRate = 48000;
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { connect() {}, disconnect() {} }; }
    resume() { return Promise.resolve(); }
    close = audioClose;
  });
  api.token.mockResolvedValue({ token: 'ephemeral', model: 'custom-live-model', wsUrl: 'wss://example.test', proxyUrl: '' });
  api.translate.mockResolvedValue({ translations: ['bonjour'] });
  callbacks = { onRecognizing: vi.fn(), onRecognized: vi.fn(), onError: vi.fn() };
  service = new GeminiSpeechService(callbacks);
});
afterEach(async () => { await service.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Gemini session lifecycle', () => {
  it('waits for setup acknowledgement before acquiring microphone and uses the token model', async () => {
    autoSetup = false;
    const starting = service.start(config, 'transcribe');
    await flush();
    expect(mic, 'microphone must wait for setupComplete').not.toHaveBeenCalled();
    expect(sockets[0].sent[0]).toMatchObject({ setup: { model: 'models/custom-live-model' } });
    sockets[0].message({ setupComplete: {} });
    await starting;
    expect(mic).toHaveBeenCalledTimes(1);
  });

  it('settles a start stopped during setup without acquiring a microphone', async () => {
    autoSetup = false;
    const starting = service.start(config, 'transcribe');
    await flush();
    await service.stop();
    await starting;
    sockets[0].message({ setupComplete: {} }); await flush();
    expect(mic, 'stopped setup must never acquire microphone').not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds an unacknowledged setup and closes its socket', async () => {
    autoSetup = false;
    const outcome = service.start(config, 'transcribe').then(() => null, (error: Error) => error);
    await flush(); await vi.advanceTimersByTimeAsync(30_000);
    expect(await outcome, 'missing setup acknowledgement must reject startup').toBeInstanceOf(Error);
    expect(sockets[0].close).toHaveBeenCalled();
    expect(mic).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('closes the socket when microphone startup fails without reporting twice', async () => {
    mic.mockRejectedValue(new Error('permission denied'));
    await expect(service.start(config, 'transcribe')).rejects.toThrow('permission denied');
    expect(sockets[0].close, 'failed microphone startup must close its socket').toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops acquired tracks when audio setup throws', async () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('audio unavailable'); } });
    await expect(service.start(config, 'transcribe')).rejects.toThrow('audio unavailable');
    expect(tracks[0].stop, 'failed audio startup must stop microphone tracks').toHaveBeenCalled();
    expect(sockets[0].close).toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('discards a translation that completes after stop', async () => {
    const translation = deferred<{ translations: string[] }>();
    api.translate.mockReturnValue(translation.promise);
    await service.start(config, 'transcribe');
    sockets[0].message({ serverContent: { inputTranscription: { text: 'old' } } });
    await flush(); expect(api.translate).toHaveBeenCalled();
    await service.stop(); translation.resolve({ translations: ['ancien'] }); await flush();
    expect(callbacks.onRecognized, 'stopped translation must not emit a final transcript').not.toHaveBeenCalled();
  });

  it('preserves final utterance order when the first translation is slow', async () => {
    const first = deferred<{ translations: string[] }>();
    api.translate.mockImplementation((text: string) => text === 'first' ? first.promise : Promise.resolve({ translations: ['second translation'] }));
    await service.start(config, 'transcribe');
    sockets[0].message({ serverContent: { inputTranscription: { text: 'first' } } });
    sockets[0].message({ serverContent: { inputTranscription: { text: 'second' } } });
    await flush(); first.resolve({ translations: ['first translation'] }); await flush();
    expect(callbacks.onRecognized.mock.calls.map(([original]) => original), 'final transcripts must preserve arrival order').toEqual(['first', 'second']);
  });

  it('ignores old socket messages and pending translations after a replacement start', async () => {
    const old = deferred<{ translations: string[] }>();
    api.translate.mockReturnValueOnce(old.promise);
    await service.start(config, 'transcribe');
    const oldSocket = sockets[0]; const delayedMessage = oldSocket.onmessage;
    oldSocket.message({ serverContent: { inputTranscription: { text: 'old' } } }); await flush();
    await service.start({ ...config, outputLanguage: 'ja' }, 'transcribe');
    delayedMessage?.({ data: JSON.stringify({ serverContent: { interimInputTranscription: { text: 'stale' } } }) });
    old.resolve({ translations: ['old translation'] }); await flush();
    expect(callbacks.onRecognizing, 'old session interim must be ignored').not.toHaveBeenCalled();
    expect(callbacks.onRecognized, 'old session final must be ignored').not.toHaveBeenCalled();
  });

  it('recycles without a false connection error and retires old callbacks', async () => {
    await service.start(config, 'transcribe');
    const old = sockets[0]; const oldMessage = old.onmessage;
    await vi.advanceTimersByTimeAsync(8 * 60 * 1000); await flush();
    expect(sockets).toHaveLength(2);
    expect(old.close).toHaveBeenCalled();
    expect(callbacks.onError, 'planned recycling must not report connection failure').not.toHaveBeenCalled();
    oldMessage?.({ data: JSON.stringify({ serverContent: { interimInputTranscription: { text: 'old' } } }) }); await flush();
    expect(callbacks.onRecognizing).not.toHaveBeenCalled();
  });

  it('cleans microphone resources and reports unexpected established close only once', async () => {
    await service.start(config, 'transcribe');
    const failed = sockets[0].onclose;
    failed?.({ code: 1011, reason: 'provider unavailable' });
    failed?.({ code: 1011, reason: 'provider unavailable' }); await flush();
    expect(callbacks.onError, 'established close must report once').toHaveBeenCalledTimes(1);
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(audioClose).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a connection failing before setup acknowledgement without also calling onError', async () => {
    autoSetup = false;
    const starting = service.start(config, 'transcribe');
    await flush();
    sockets[0].onerror?.(); sockets[0].onclose?.({ code: 1006, reason: '' });
    const error = await starting.then(() => null, (reason: Error) => reason);
    expect(error, 'startup socket failure must reject').toBeInstanceOf(Error);
    expect(callbacks.onError, 'startup failure must use only the rejecting promise').not.toHaveBeenCalled();
  });
});
