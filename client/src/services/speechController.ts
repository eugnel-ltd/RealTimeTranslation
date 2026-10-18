import { AzureSpeechService, type TranslationConfig } from './azureSpeech';
import { GeminiSpeechService } from './geminiSpeech';
import { rememberQuotaFallbackForMonth, shouldPreferFallbackThisMonth } from './fallbackMemory';
import type { SpeechEngineMode } from '../types';
import { assertRuntime, type AppRuntime } from './accountLifetime';

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
  private session = 0;
  private activeEngine: 'azure' | 'gemini' | null = null;
  private starting = false;
  private fallback: Promise<void> | null = null;

  constructor(private readonly callbacks: Callbacks, private readonly runtime?: AppRuntime) {
    this.azure = new AzureSpeechService({
      onRecognizing: (...args) => { if (this.activeEngine === 'azure') this.callbacks.onRecognizing(...args); },
      onRecognized: (...args) => { if (this.activeEngine === 'azure') this.callbacks.onRecognized(...args); },
      onError: (error) => this.handleError('azure', error),
      onQuotaExhausted: (message, atStart) => {
        if (this.activeEngine !== 'azure') return;
        const session = this.session;
        this.fallback = this.handleAzureQuota(message, atStart);
        void this.fallback.catch((error: unknown) => {
          if (session === this.session && !this.starting) this.handleError('gemini', error instanceof Error ? error.message : 'Failed to start Gemini fallback');
        });
      },
    }, runtime);
    this.gemini = new GeminiSpeechService({
      onRecognizing: (...args) => { if (this.activeEngine === 'gemini') this.callbacks.onRecognizing(...args); },
      onRecognized: (...args) => { if (this.activeEngine === 'gemini') this.callbacks.onRecognized(...args); },
      onError: (error) => this.handleError('gemini', error),
    }, runtime);
  }

  async start(config: TranslationConfig, mode: SpeechEngineMode) {
    assertRuntime(this.runtime);
    const stopping = this.stop();
    const session = this.session;
    await stopping;
    assertRuntime(this.runtime);
    if (session !== this.session) return;
    this.config = { ...config };
    this.mode = mode;
    this.starting = true;
    try {
      let preferFallback = false;
      try { preferFallback = mode === 'auto' && shouldPreferFallbackThisMonth(this.runtime?.storage); } catch { /* Prefer Azure when storage is unavailable. */ }
      if (mode === 'gemini-translator' || mode === 'gemini-live-translate' || preferFallback) {
        this.activeEngine = 'gemini';
        if (preferFallback) this.callbacks.onNotice('Using Gemini transcription + translation this month after a previous Azure Speech quota limit.');
        await this.gemini.start(this.config, mode === 'gemini-live-translate' ? 'translate' : 'transcribe');
      } else {
        this.activeEngine = 'azure';
        await this.azure.startTranslation(this.config);
        if (session === this.session && this.fallback) await this.fallback;
      }
    } catch (error) {
      if (session !== this.session) return;
      await this.stop();
      throw error;
    } finally {
      if (session === this.session) this.starting = false;
    }
  }

  private async handleAzureQuota(message: string, atStart: boolean) {
    const session = this.session;
    const config = this.config;
    this.activeEngine = null;
    await this.azure.stopTranslation().catch(() => undefined);
    if (session !== this.session || !config || (this.runtime && !this.runtime.active)) return;
    try { rememberQuotaFallbackForMonth(this.runtime?.storage); } catch { /* Storage restrictions must not prevent fallback. */ }
    if (this.mode === 'azure') {
      this.activeEngine = 'azure';
      this.handleError('azure', 'Azure Speech quota exhausted (Azure only mode).');
      return;
    }
    const hint = atStart
      ? ' A 429 at start can mean a second concurrent session on the Azure F0 tier.'
      : '';
    this.callbacks.onNotice(
      `${message}${hint} Switched to Gemini transcription + translation for the rest of this month.`,
    );
    this.activeEngine = 'gemini';
    await this.gemini.start(config, 'transcribe');
  }

  private handleError(engine: 'azure' | 'gemini', error: string) {
    if (this.activeEngine !== engine) return;
    void this.stop();
    this.callbacks.onError(error);
  }

  async stop() {
    ++this.session;
    this.activeEngine = null;
    this.config = null;
    this.starting = false;
    this.fallback = null;
    await Promise.allSettled([this.azure.stopTranslation(), this.gemini.stop()]);
  }
}
