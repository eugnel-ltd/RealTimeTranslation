import * as speechsdk from 'microsoft-cognitiveservices-speech-sdk';
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
  private lastInterimResult: { text: string; translations: string[]; language?: string } | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;

  constructor(private readonly callbacks: SpeechCallbacks) {}

  async startTranslation(config: TranslationConfig) {
    if (this.isRecognizing) {
      await this.stopTranslation();
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());

    const { token, region } = await fetchSpeechToken();
    const speechConfig = speechsdk.SpeechTranslationConfig.fromAuthorizationToken(token, region);
    this.applyLanguages(speechConfig, config);
    this.applyRecognitionProperties(speechConfig);

    const audioConfig = speechsdk.AudioConfig.fromDefaultMicrophoneInput();
    this.translationRecognizer = new speechsdk.TranslationRecognizer(speechConfig, audioConfig);
    this.setupRecognizer(this.translationRecognizer);
    await new Promise<void>((resolve, reject) => {
      this.translationRecognizer!.startContinuousRecognitionAsync(resolve, reject);
    });
    this.isRecognizing = true;
    this.startedAt = Date.now();
    this.scheduleTokenRefresh();
  }

  private applyLanguages(speechConfig: speechsdk.SpeechTranslationConfig, config: TranslationConfig) {
    if (config.inputLanguage === 'auto') {
      speechConfig.speechRecognitionLanguage = 'en-US';
      speechConfig.setProperty(speechsdk.PropertyId.SpeechServiceConnection_LanguageIdMode, 'Continuous');
      speechConfig.setProperty(
        speechsdk.PropertyId.SpeechServiceConnection_AutoDetectSourceLanguages,
        ['en-US', 'zh-CN', 'es-ES', 'hi-IN', 'ar-SA', 'fr-FR', 'ru-RU', 'pt-BR', 'ja-JP', 'de-DE'].join(','),
      );
    } else {
      speechConfig.speechRecognitionLanguage = config.inputLanguage === 'yue' ? 'zh-HK' : config.inputLanguage;
    }
    speechConfig.addTargetLanguage(config.outputLanguage);
    if (config.secondOutputLanguage) {
      speechConfig.addTargetLanguage(config.secondOutputLanguage);
    }
  }

  private applyRecognitionProperties(speechConfig: speechsdk.SpeechTranslationConfig) {
    speechConfig.setProperty(speechsdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '15000');
    speechConfig.setProperty(speechsdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '5000');
    speechConfig.setProperty(speechsdk.PropertyId.SpeechServiceResponse_RequestDetailedResultTrueFalse, 'true');
    speechConfig.setProperty(speechsdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '300');
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
    try {
      const { token } = await fetchSpeechToken();
      this.translationRecognizer.authorizationToken = token;
    } catch (err) {
      console.error('Failed to refresh Azure Speech token', err);
    }
  }

  private setupRecognizer(recognizer: speechsdk.TranslationRecognizer) {
    recognizer.recognizing = (_, event) => {
      const result = event.result;
      if (result.reason !== speechsdk.ResultReason.TranslatingSpeech) return;
      const translations = extractTranslations(result.translations);
      this.lastInterimResult = { text: result.text, translations, language: result.language };
      this.callbacks.onRecognizing(result.text, translations, result.language);
    };

    recognizer.recognized = (_, event) => {
      const result = event.result;
      if (result.reason !== speechsdk.ResultReason.TranslatedSpeech) return;
      const translations = extractTranslations(result.translations);
      if (this.lastInterimResult?.text === result.text) this.lastInterimResult = null;
      this.callbacks.onRecognized(result.text, translations, result.language);
    };

    recognizer.canceled = (_, event) => {
      if (event.reason !== speechsdk.CancellationReason.Error) return;
      const errorCodeName = speechsdk.CancellationErrorCode[event.errorCode] ?? String(event.errorCode);
      const atStart = Date.now() - this.startedAt < 8000;
      if (
        isQuotaExhaustion({
          errorCode: event.errorCode,
          errorCodeName,
          errorDetails: event.errorDetails,
          atStart,
        })
      ) {
        void this.stopTranslation();
        this.callbacks.onQuotaExhausted?.(
          `Azure Speech quota / concurrency limit (${errorCodeName}). ${event.errorDetails}`,
          atStart,
        );
        return;
      }
      this.callbacks.onError(`Error: ${event.errorDetails} (Code: ${event.errorCode})`);
    };
  }

  async stopTranslation(): Promise<void> {
    this.clearRefresh();
    if (!this.translationRecognizer || !this.isRecognizing) return;
    const recognizer = this.translationRecognizer;
    await new Promise<void>((resolve, reject) => {
      recognizer.stopContinuousRecognitionAsync(
        () => {
          this.isRecognizing = false;
          resolve();
        },
        (err) => {
          this.isRecognizing = false;
          reject(err);
        },
      );
    });
  }

  private clearRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

function extractTranslations(translations: speechsdk.Translations): string[] {
  const translationsObj = translations as unknown as { privMap?: { privValues?: unknown[] } };
  const values = translationsObj.privMap?.privValues;
  if (Array.isArray(values)) return values as string[];
  return [];
}
