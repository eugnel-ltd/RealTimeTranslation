import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AzureSpeechService } from '../client/src/services/azureSpeech';
import { SpeechController } from '../client/src/services/speechController';

const mocks = vi.hoisted(() => ({ token: vi.fn(), geminiStart: vi.fn(), geminiStop: vi.fn(), recognizers: [] as any[], geminiCallbacks: null as any }));
vi.mock('../client/src/services/api', () => ({ fetchSpeechToken: mocks.token }));
vi.mock('../client/src/services/geminiSpeech', () => ({ GeminiSpeechService: class {
  constructor(callbacks: unknown) { mocks.geminiCallbacks = callbacks; }
  start = mocks.geminiStart;
  stop = mocks.geminiStop;
} }));
vi.mock('../client/src/services/fallbackMemory', () => ({ rememberQuotaFallbackForMonth() {}, shouldPreferFallbackThisMonth: () => false }));
vi.mock('../client/node_modules/microsoft-cognitiveservices-speech-sdk', () => ({
  SpeechTranslationConfig: { fromAuthorizationToken: () => ({ setProperty() {}, addTargetLanguage() {}, enableDictation() {} }) },
  PropertyId: {}, ResultReason: { TranslatingSpeech: 1, TranslatedSpeech: 2 }, CancellationReason: { Error: 1 }, CancellationErrorCode: { 7: 'TooManyRequests' },
  AudioConfig: { fromDefaultMicrophoneInput: () => ({}) },
  TranslationRecognizer: class {
    constructor() { mocks.recognizers.push(this); }
    startContinuousRecognitionAsync = (done: () => void) => done();
    stopContinuousRecognitionAsync = vi.fn((done: () => void) => done());
    close = vi.fn();
  },
}));
const config = { inputLanguage: 'en-US', outputLanguage: 'fr', secondOutputLanguage: 'ja' };
let callbacks: {
  onRecognizing: ReturnType<typeof vi.fn<(original: string, translations: string[], detectedLanguage?: string) => void>>;
  onRecognized: ReturnType<typeof vi.fn<(original: string, translations: string[], detectedLanguage?: string) => void>>;
  onError: ReturnType<typeof vi.fn<(message: string) => void>>;
  onNotice: ReturnType<typeof vi.fn<(message: string) => void>>;
};
let stop: (() => Promise<void>) | undefined;
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function final(text: string) { return { result: { reason: 2, text, language: 'en-US', translations: { languages: ['ja', 'fr'], get: (language: string) => language === 'fr' ? 'bonjour' : 'こんにちは' } } }; }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.recognizers.length = 0;
  callbacks = { onRecognizing: vi.fn(), onRecognized: vi.fn(), onError: vi.fn(), onNotice: vi.fn() };
  mocks.token.mockResolvedValue({ token: 'ephemeral', region: 'uksouth' });
  mocks.geminiStart.mockResolvedValue(undefined); mocks.geminiStop.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
});
afterEach(async () => { await stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Azure speech lifecycle', () => {
  it('uses public translation getters in requested target order', async () => {
    const service = new AzureSpeechService(callbacks); stop = () => service.stopTranslation();
    await service.startTranslation(config);
    mocks.recognizers[0].recognized(null, final('hello'));
    expect(callbacks.onRecognized, 'translations must use the supported SDK API in target order').toHaveBeenCalledWith('hello', ['bonjour', 'こんにちは'], 'en-US');
  });

  it('ignores recognizer final, interim and cancellation callbacks after stop', async () => {
    const service = new AzureSpeechService(callbacks); stop = () => service.stopTranslation();
    await service.startTranslation(config); const recognizer = mocks.recognizers[0];
    await service.stopTranslation();
    recognizer.recognized(null, final('old'));
    recognizer.recognizing(null, { result: { ...final('old').result, reason: 1 } });
    recognizer.canceled(null, { reason: 1, errorCode: 3, errorDetails: 'old failure' });
    expect(callbacks.onRecognized, 'stopped recognizer final must be ignored').not.toHaveBeenCalled();
    expect(callbacks.onRecognizing).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('ignores callbacks from the recognizer replaced by a new start', async () => {
    const service = new AzureSpeechService(callbacks); stop = () => service.stopTranslation();
    await service.startTranslation(config); const old = mocks.recognizers[0];
    await service.startTranslation(config); old.recognized(null, final('obsolete'));
    expect(callbacks.onRecognized, 'replaced recognizer must not emit into current session').not.toHaveBeenCalled();
  });
});

describe('speech controller engine ownership', () => {
  it('stops the active Azure engine before switching to Gemini', async () => {
    const controller = new SpeechController(callbacks); stop = () => controller.stop();
    await controller.start(config, 'azure'); const old = mocks.recognizers[0];
    await controller.start(config, 'gemini-translator');
    expect(old.stopContinuousRecognitionAsync, 'switching engines must stop the old recognizer').toHaveBeenCalledTimes(1);
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(mocks.geminiStart).toHaveBeenCalledTimes(1);
  });

  it('cannot begin a quota fallback after stop cancels the session', async () => {
    const controller = new SpeechController(callbacks); stop = () => controller.stop();
    await controller.start(config, 'auto');
    mocks.recognizers[0].canceled(null, { reason: 1, errorCode: 7, errorDetails: 'quota exhausted' });
    await controller.stop(); await flush();
    expect(mocks.geminiStart, 'stopped session must not start a late quota fallback').not.toHaveBeenCalled();
  });

  it('ignores callbacks from Gemini after stop', async () => {
    const controller = new SpeechController(callbacks); stop = () => controller.stop();
    await controller.start(config, 'gemini-translator'); const stale = mocks.geminiCallbacks;
    await controller.stop(); stale.onRecognized('old', []); stale.onError('old failure');
    expect(callbacks.onRecognized, 'stopped controller must ignore old engine callbacks').not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});
