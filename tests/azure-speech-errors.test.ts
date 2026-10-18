import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AzureSpeechService } from '../client/src/services/azureSpeech';

type Cancellation = { reason: number; errorCode: number; errorDetails: string };
type Recognizer = { canceled?: (sender: unknown, event: Cancellation) => void };
const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  start: vi.fn<(done: () => void, fail: (error: string) => void) => void>(),
  close: vi.fn(),
  recognizers: [] as Recognizer[],
}));
vi.mock('../client/src/services/api', () => ({ fetchSpeechToken: mocks.token }));
vi.mock('../client/node_modules/microsoft-cognitiveservices-speech-sdk', () => ({
  SpeechTranslationConfig: { fromAuthorizationToken: () => ({ setProperty() {}, addTargetLanguage() {}, enableDictation() {} }) },
  PropertyId: {},
  CancellationReason: { Error: 1 },
  CancellationErrorCode: { 1: 'AuthenticationFailure', 3: 'TooManyRequests', 4: 'ConnectionFailure' },
  AudioConfig: { fromDefaultMicrophoneInput: () => ({}) },
  TranslationRecognizer: class implements Recognizer {
    canceled?: (sender: unknown, event: Cancellation) => void;
    constructor() { mocks.recognizers.push(this); }
    startContinuousRecognitionAsync = mocks.start;
    stopContinuousRecognitionAsync = (done: () => void) => done();
    close = mocks.close;
  },
}));

const config = { inputLanguage: 'en-US', outputLanguage: 'fr' };
let service: AzureSpeechService;
function createCallbacks() {
  return {
    onRecognizing: vi.fn<(original: string, translations: string[], detectedLanguage?: string) => void>(),
    onRecognized: vi.fn<(original: string, translations: string[], detectedLanguage?: string) => void>(),
    onError: vi.fn<(message: string) => void>(),
    onQuotaExhausted: vi.fn<(message: string, atStart: boolean) => void>(),
  };
}
let callbacks: ReturnType<typeof createCallbacks>;
let microphone: ReturnType<typeof vi.fn<() => Promise<MediaStream>>>;
let stopTrack: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.recognizers.length = 0;
  mocks.token.mockResolvedValue({ token: 'synthetic-short-lived-token', region: 'uksouth' });
  mocks.start.mockImplementation(done => done());
  callbacks = createCallbacks();
  service = new AzureSpeechService(callbacks);
  stopTrack = vi.fn();
  microphone = vi.fn<() => Promise<MediaStream>>().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: microphone } });
});

afterEach(async () => {
  await service.stopTranslation();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('actionable Azure errors without duplicate delivery', () => {
  it('rejects a startup 1006 once with connection guidance and closes the recognizer', async () => {
    mocks.start.mockImplementation((_done, fail) => fail('Unable to contact server. StatusCode: 1006'));
    await expect(service.startTranslation(config)).rejects.toThrow(/check your network connection/i);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onQuotaExhausted).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a typed established connection failure once and stops that session', async () => {
    await service.startTranslation(config);
    const recognizer = mocks.recognizers[0];
    recognizer.canceled?.(null, { reason: 1, errorCode: 4, errorDetails: 'WebSocket abnormal closure' });
    recognizer.canceled?.(null, { reason: 1, errorCode: 4, errorDetails: 'duplicate stale event' });
    await Promise.resolve();
    expect(callbacks.onError).toHaveBeenCalledOnce();
    expect(callbacks.onError.mock.calls[0][0]).toMatch(/check your network connection/i);
    expect(callbacks.onQuotaExhausted).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns a connection cancellation during startup into only the startup rejection', async () => {
    mocks.start.mockImplementation(() => undefined);
    const result = service.startTranslation(config).then(() => null, (error: Error) => error);
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    mocks.recognizers[0].canceled?.(null, { reason: 1, errorCode: 4, errorDetails: 'ConnectionFailure' });
    expect((await result)?.message).toMatch(/check your network connection/i);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['NotAllowedError', 'PermissionDeniedError'])('explains browser microphone permission refusal %s before token fetch', async (name) => {
    microphone.mockRejectedValue(new DOMException('Permission denied', name));
    await expect(service.startTranslation(config)).rejects.toThrow(/allow microphone access.*browser/i);
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.recognizers).toHaveLength(0);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves an unknown startup error and still rejects without an onError duplicate', async () => {
    mocks.start.mockImplementation((_done, fail) => fail('Synthetic SDK configuration error'));
    await expect(service.startTranslation(config)).rejects.toThrow('Synthetic SDK configuration error');
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('keeps an authoritative authentication category instead of guessing from 1006 text', async () => {
    await service.startTranslation(config);
    mocks.recognizers[0].canceled?.(null, { reason: 1, errorCode: 1, errorDetails: 'AuthenticationFailure; prior transport StatusCode: 1006' });
    expect(callbacks.onError).toHaveBeenCalledOnce();
    expect(callbacks.onError.mock.calls[0][0]).toContain('AuthenticationFailure');
    expect(callbacks.onError.mock.calls[0][0]).not.toMatch(/check your network connection/i);
    expect(callbacks.onQuotaExhausted).not.toHaveBeenCalled();
  });

  it('keeps quota cancellation on its separate fallback callback', async () => {
    await service.startTranslation(config);
    mocks.recognizers[0].canceled?.(null, { reason: 1, errorCode: 3, errorDetails: '429 quota exhausted' });
    expect(callbacks.onQuotaExhausted).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('ignores an old connection error after the session has stopped', async () => {
    await service.startTranslation(config);
    const stale = mocks.recognizers[0];
    await service.stopTranslation();
    stale.canceled?.(null, { reason: 1, errorCode: 4, errorDetails: 'ConnectionFailure' });
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onQuotaExhausted).not.toHaveBeenCalled();
  });
});
