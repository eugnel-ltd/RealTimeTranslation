import { AzureSpeechService, type TranslationConfig } from './azureSpeech';
import { GeminiSpeechService } from './geminiSpeech';
import { rememberQuotaFallbackForMonth, shouldPreferFallbackThisMonth } from './fallbackMemory';
import type { SpeechEngineMode } from '../types';

type Callbacks = {
  onRecognizing: (original: string, translations: string[], detectedLanguage?: string) => void;
  onRecognized: (original: string, translations: string[], detectedLanguage?: string) => void;
  onError: (error: string) => void;
  onNotice: (message: string) => void;
};

export class SpeechController {
  private azure: AzureSpeechService;
  private gemini: GeminiSpeechService;
  private config: TranslationConfig | null = null;
  private mode: SpeechEngineMode = 'auto';

  constructor(private readonly callbacks: Callbacks) {
    this.azure = new AzureSpeechService({
      onRecognizing: (...args) => this.callbacks.onRecognizing(...args),
      onRecognized: (...args) => this.callbacks.onRecognized(...args),
      onError: (error) => this.callbacks.onError(error),
      onQuotaExhausted: (message, atStart) => {
        void this.handleAzureQuota(message, atStart);
      },
    });
    this.gemini = new GeminiSpeechService({
      onRecognizing: (...args) => this.callbacks.onRecognizing(...args),
      onRecognized: (...args) => this.callbacks.onRecognized(...args),
      onError: (error) => this.callbacks.onError(error),
    });
  }

  async start(config: TranslationConfig, mode: SpeechEngineMode) {
    this.config = config;
    this.mode = mode;
    if (mode === 'azure') {
      await this.azure.startTranslation(config);
      return;
    }
    if (mode === 'gemini-translator') {
      await this.gemini.start(config, 'transcribe');
      return;
    }
    if (mode === 'gemini-live-translate') {
      await this.gemini.start(config, 'translate');
      return;
    }
    if (shouldPreferFallbackThisMonth()) {
      this.callbacks.onNotice(
        'Using Gemini transcription + translation this month after a previous Azure Speech quota limit.',
      );
      await this.gemini.start(config, 'transcribe');
      return;
    }
    await this.azure.startTranslation(config);
  }

  private async handleAzureQuota(message: string, atStart: boolean) {
    rememberQuotaFallbackForMonth();
    const hint = atStart
      ? ' A 429 at start can mean a second concurrent session on the Azure F0 tier.'
      : '';
    this.callbacks.onNotice(
      `${message}${hint} Switched to Gemini transcription + translation for the rest of this month.`,
    );
    if (this.mode === 'azure') {
      this.callbacks.onError('Azure Speech quota exhausted (Azure only mode).');
      return;
    }
    if (!this.config) return;
    try {
      await this.gemini.start(this.config, 'transcribe');
    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err.message : 'Failed to start Gemini fallback');
    }
  }

  async stop() {
    await Promise.allSettled([this.azure.stopTranslation(), this.gemini.stop()]);
  }
}
