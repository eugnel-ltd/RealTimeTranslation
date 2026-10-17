import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AzureSpeechService } from '../client/src/services/azureSpeech';
import { GeminiSpeechService } from '../client/src/services/geminiSpeech';

const mocks = vi.hoisted(() => ({ token: vi.fn(), geminiToken: vi.fn(), recognize: vi.fn(), close: vi.fn() }));
vi.mock('../client/src/services/api', () => ({ fetchSpeechToken: mocks.token, fetchGeminiToken: mocks.geminiToken }));
vi.mock('../client/node_modules/microsoft-cognitiveservices-speech-sdk', () => ({
  SpeechTranslationConfig: { fromAuthorizationToken: () => ({ setProperty() {}, addTargetLanguage() {}, enableDictation() {} }) },
  PropertyId: {},
  AudioConfig: { fromDefaultMicrophoneInput: () => ({}) },
  TranslationRecognizer: class {
    startContinuousRecognitionAsync = mocks.recognize;
    stopContinuousRecognitionAsync = (done: () => void) => done();
    close = mocks.close;
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const config = { inputLanguage: 'en-US', outputLanguage: 'fr' };
const token = { token: 'temporary', region: 'uksouth', wsUrl: 'wss://example.test', proxyUrl: '' };
const callbacks = { onRecognizing: vi.fn(), onRecognized: vi.fn(), onError: vi.fn() };
let tracks: Array<{ stop: ReturnType<typeof vi.fn> }>;
let mic: ReturnType<typeof vi.fn>;
let sockets: FakeSocket[];
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  onopen?: () => void;
  onclose?: (event: unknown) => void;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; });
  constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
}
function stream() {
  const track = { stop: vi.fn() };
  tracks.push(track);
  return { getTracks: () => [track] } as unknown as MediaStream;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  tracks = []; sockets = [];
  mic = vi.fn(async () => stream());
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: mic } });
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('AudioContext', class {
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { connect() {}, disconnect() {} }; }
    close() {}
  });
  mocks.token.mockResolvedValue(token);
  mocks.geminiToken.mockResolvedValue(token);
  mocks.recognize.mockImplementation((done: () => void) => done());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

for (const engine of ['Azure', 'Gemini'] as const) {
  describe(`${engine} startup cancellation`, () => {
    function service() {
      if (engine === 'Azure') {
        const azure = new AzureSpeechService(callbacks);
        return { start: () => azure.startTranslation(config), stop: () => azure.stopTranslation() };
      }
      const gemini = new GeminiSpeechService(callbacks);
      return { start: () => gemini.start(config, 'transcribe'), stop: () => gemini.stop() };
    }
    it('does not start recognition or open a microphone after stop during token fetch', async () => {
      const pending = deferred<typeof token>();
      const fetchToken = engine === 'Azure' ? mocks.token : mocks.geminiToken;
      fetchToken.mockReturnValue(pending.promise);
      const speech = service();
      const starting = speech.start();
      await vi.waitFor(() => expect(fetchToken).toHaveBeenCalled());
      await speech.stop();
      pending.resolve(token);
      await starting;
      expect(mocks.recognize).not.toHaveBeenCalled();
      expect(sockets).toHaveLength(0);
      expect(mic).toHaveBeenCalledTimes(engine === 'Azure' ? 1 : 0);
      for (const track of tracks) expect(track.stop).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
    it('stops tracks returned by a microphone request that resolves after stop', async () => {
      const pending = deferred<MediaStream>();
      mic.mockReturnValue(pending.promise);
      const speech = service();
      const starting = speech.start();
      await vi.waitFor(() => expect(mic).toHaveBeenCalled());
      await speech.stop();
      pending.resolve(stream());
      await starting;
      expect(mocks.recognize).not.toHaveBeenCalled();
      for (const track of tracks) expect(track.stop).toHaveBeenCalled();
      for (const socket of sockets) expect(socket.close).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
    it('honours stop called immediately after start', async () => {
      const speech = service();
      const starting = speech.start();
      await speech.stop();
      await starting;
      expect(mocks.recognize).not.toHaveBeenCalled();
      expect(sockets).toHaveLength(0);
      for (const track of tracks) expect(track.stop).toHaveBeenCalled();
    });
  });
}

it('closes an Azure recognizer whose startup callback arrives after stop', async () => {
  let started!: () => void;
  mocks.recognize.mockImplementation((done: () => void) => { started = done; });
  const speech = new AzureSpeechService(callbacks);
  const starting = speech.startTranslation(config);
  await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalled());
  await speech.stopTranslation();
  started();
  await starting;
  expect(mocks.close).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
