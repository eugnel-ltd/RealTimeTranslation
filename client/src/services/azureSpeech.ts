import type * as speechsdk from 'microsoft-cognitiveservices-speech-sdk';
import { toTranslatorCode } from '../../../worker/src/languages';
import { fetchSpeechToken } from './api';
import { isQuotaExhaustion } from './quota';

export interface TranslationConfig {
  inputLanguage: string;
  outputLanguage: string;
  secondOutputLanguage?: string;
}

type SpeechCallbacks = {
  onRecognizing: (original: string, translations: string[], detectedLanguage?: string) => void;
  onRecognized: (original: string, translations: string[], detectedLanguage?: string) => void;
  onError: (error: string) => void;
  onQuotaExhausted?: (message: string, atStart: boolean) => void;
};

export class AzureSpeechService {
  private translationRecognizer: speechsdk.TranslationRecognizer | null = null;
  private isRecognizing = false;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private session = 0;
  private cancelStart: (() => void) | null = null;
  private failStart: ((error: Error) => void) | null = null;
  private stopping: Promise<void> = Promise.resolve();

  constructor(private readonly callbacks: SpeechCallbacks) {}

  async startTranslation(config: TranslationConfig) {
    config = { ...config };
    const stopping = this.stopTranslation();
    const session = this.session;
    await stopping;
    if (session !== this.session) return;

    const sdk = await import('microsoft-cognitiveservices-speech-sdk');
    if (session !== this.session) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    if (session !== this.session) return;

    const { token, region } = await fetchSpeechToken();
    if (session !== this.session) return;
    const speechConfig = sdk.SpeechTranslationConfig.fromAuthorizationToken(token, region);
    this.applyLanguages(speechConfig, config, sdk);
    this.applyRecognitionProperties(speechConfig, sdk);

    const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
    const recognizer = new sdk.TranslationRecognizer(speechConfig, audioConfig);
    this.translationRecognizer = recognizer;
    const targets = [config.outputLanguage, config.secondOutputLanguage].filter((language): language is string => Boolean(language)).map(toTranslatorCode);
    this.setupRecognizer(recognizer, session, targets, sdk);
    this.startedAt = Date.now();
    try {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          if (this.cancelStart !== cancel) return;
          this.cancelStart = null;
          this.failStart = null;
          if (error) reject(error);
          else resolve();
        };
        const cancel = () => finish();
        this.cancelStart = cancel;
        this.failStart = (error) => finish(error);
        recognizer.startContinuousRecognitionAsync(() => finish(), (error) => finish(new Error(String(error))));
      });
    } catch (err) {
      if (session !== this.session) return;
      await this.stopTranslation();
      throw err;
    }
    // stopTranslation already disposed this session's recognizer.
    if (session !== this.session) return;
    this.isRecognizing = true;
    this.scheduleTokenRefresh();
  }

  private applyLanguages(speechConfig: speechsdk.SpeechTranslationConfig, config: TranslationConfig, sdk: typeof speechsdk) {
    if (config.inputLanguage === 'auto') {
      speechConfig.speechRecognitionLanguage = 'en-US';
      speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_LanguageIdMode, 'Continuous');
      speechConfig.setProperty(
        sdk.PropertyId.SpeechServiceConnection_AutoDetectSourceLanguages,
        ['en-US', 'zh-CN', 'es-ES', 'hi-IN', 'ar-SA', 'fr-FR', 'ru-RU', 'pt-BR', 'ja-JP', 'de-DE'].join(','),
      );
    } else {
      speechConfig.speechRecognitionLanguage = config.inputLanguage === 'yue' ? 'zh-HK' : config.inputLanguage;
    }
    speechConfig.addTargetLanguage(toTranslatorCode(config.outputLanguage));
    if (config.secondOutputLanguage) {
      speechConfig.addTargetLanguage(toTranslatorCode(config.secondOutputLanguage));
    }
  }

  private applyRecognitionProperties(speechConfig: speechsdk.SpeechTranslationConfig, sdk: typeof speechsdk) {
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '15000');
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '5000');
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_RequestDetailedResultTrueFalse, 'true');
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '300');
    speechConfig.enableDictation();
  }

  private scheduleTokenRefresh() {
    this.clearRefresh();
    this.refreshTimer = setInterval(() => {
      void this.refreshToken();
    }, 9 * 60 * 1000);
  }

  private async refreshToken() {
    if (!this.translationRecognizer || !this.isRecognizing) return;
    const recognizer = this.translationRecognizer;
    const session = this.session;
    try {
      const { token } = await fetchSpeechToken();
      if (session !== this.session) return;
      recognizer.authorizationToken = token;
    } catch (err) {
      console.error('Failed to refresh Azure Speech token', err);
    }
  }

  private setupRecognizer(recognizer: speechsdk.TranslationRecognizer, session: number, targets: string[], sdk: typeof speechsdk) {
    const current = () => session === this.session && recognizer === this.translationRecognizer;
    recognizer.recognizing = (_, event) => {
      if (!current()) return;
      const result = event.result;
      if (result.reason !== sdk.ResultReason.TranslatingSpeech) return;
      const translations = targets.map((target) => result.translations.get(target, ''));
      this.callbacks.onRecognizing(result.text, translations, result.language);
    };

    recognizer.recognized = (_, event) => {
      if (!current()) return;
      const result = event.result;
      if (result.reason !== sdk.ResultReason.TranslatedSpeech) return;
      const translations = targets.map((target) => result.translations.get(target, ''));
      this.callbacks.onRecognized(result.text, translations, result.language);
    };

    recognizer.canceled = (_, event) => {
      if (!current()) return;
      if (event.reason !== sdk.CancellationReason.Error) return;
      const errorCodeName = sdk.CancellationErrorCode[event.errorCode] ?? String(event.errorCode);
      const atStart = Date.now() - this.startedAt < 8000;
      if (
        isQuotaExhaustion({
          errorCode: event.errorCode,
          errorCodeName,
          errorDetails: event.errorDetails,
          atStart,
        })
      ) {
        void this.stopTranslation().catch(() => undefined);
        this.callbacks.onQuotaExhausted?.(
          `Azure Speech quota / concurrency limit (${errorCodeName}). ${event.errorDetails}`,
          atStart,
        );
        return;
      }
      const message = `Error: ${event.errorDetails} (Code: ${event.errorCode})`;
      if (this.failStart) {
        this.failStart(new Error(message));
        return;
      }
      void this.stopTranslation().catch(() => undefined);
      this.callbacks.onError(message);
    };
  }

  async stopTranslation(): Promise<void> {
    ++this.session;
    this.cancelStart?.();
    this.clearRefresh();
    const recognizer = this.translationRecognizer;
    this.translationRecognizer = null;
    this.isRecognizing = false;
    if (!recognizer) return this.stopping;
    const stopping = new Promise<void>((resolve, reject) => {
        recognizer.stopContinuousRecognitionAsync(resolve, reject);
    }).finally(() => {
      recognizer.close();
    });
    this.stopping = stopping.catch(() => undefined);
    await stopping;
  }

  private clearRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
