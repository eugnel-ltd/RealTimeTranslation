import { geminiLiveSetup } from '../../../shared/geminiLive';
import { fetchGeminiToken, translateText, type GeminiToken } from './api';
import { arrayBufferToBase64, floatTo16BitPcm, resample } from './pcm';
import type { TranslationConfig } from './azureSpeech';
import { assertRuntime, type AppRuntime } from './accountLifetime';

type SpeechCallbacks = {
  onRecognizing: (original: string, translations: string[], detectedLanguage?: string) => void;
  onRecognized: (original: string, translations: string[], detectedLanguage?: string) => void;
  onError: (error: string) => void;
};
type GeminiMode = 'transcribe' | 'translate';
type Session = { id: number; config: TranslationConfig; mode: GeminiMode; started: boolean; failure?: Error; translationAbort?: AbortController };
type GeminiMessage = {
  setupComplete?: unknown;
  serverContent?: {
    interimInputTranscription?: { text?: string; languageCode?: string };
    inputTranscription?: { text?: string; languageCode?: string };
    outputTranscription?: { text?: string; languageCode?: string };
  };
};
const SETUP_TIMEOUT_MS = 15_000;
const TRANSLATION_TIMEOUT_MS = 15_000;

export class GeminiSpeechService {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mediaStream: MediaStream | null = null;
  private session = 0;
  private active: Session | null = null;
  private interimInput = '';
  private interimOutput = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelSocketStart: (() => void) | null = null;

  constructor(private readonly callbacks: SpeechCallbacks, private readonly runtime?: AppRuntime) {}

  async start(config: TranslationConfig, mode: GeminiMode): Promise<void> {
    assertRuntime(this.runtime);
    const stopping = this.stop();
    const id = this.session;
    await stopping;
    if (id !== this.session) return;
    const session: Session = { id, config: { ...config }, mode, started: false };
    this.active = session;
    try {
      const token = await this.mintToken(session);
      if (!this.current(session)) return;
      await this.openSocket(token, session);
      if (session.failure) throw session.failure;
      if (!this.current(session)) return;
      await this.startMic(session);
      if (session.failure) throw session.failure;
      if (!this.current(session)) return;
      session.started = true;
      this.reconnectTimer = setTimeout(() => {
        if (!this.current(session)) return;
        const restarting = this.start(session.config, session.mode);
        const restartGeneration = this.session;
        void restarting.catch((error: unknown) => {
          // A failed start disposes its generation once. A later start/stop owns any further generation.
          if (this.active || this.session !== restartGeneration + 1) return;
          this.callbacks.onError(error instanceof Error ? error.message : 'Gemini reconnect failed');
        });
      }, 8 * 60 * 1000);
    } catch (error) {
      const current = this.current(session);
      if (current) await this.stop();
      if (current || session.failure) throw error;
    }
  }

  private current(session: Session): boolean {
    return (!this.runtime || this.runtime.active) && this.active === session && session.id === this.session;
  }

  private async mintToken(session: Session): Promise<GeminiToken> {
    const { config, mode } = session;
    try {
      return await fetchGeminiToken(mode, config.outputLanguage, this.runtime);
    } catch {
      assertRuntime(this.runtime);
      const target = config.outputLanguage ? `&target=${encodeURIComponent(config.outputLanguage)}` : '';
      return { token: '', expireTime: '', model: '', mode, wsUrl: '', proxyUrl: `/api/gemini-live?mode=${mode}${target}` };
    }
  }

  private openSocket(token: GeminiToken, session: Session): Promise<void> {
    return new Promise((resolve, reject) => {
      let proxy = token.proxyUrl;
      if (!token.wsUrl && this.runtime?.accountMode) {
        if (!this.runtime.accountId) { reject(new Error('Verified account unavailable')); return; }
        const query = new URLSearchParams(proxy.split('?')[1] ?? '');
        query.set('expectedAccount', `account:${this.runtime.accountId}`);
        proxy = `${proxy.split('?')[0]}?${query}`;
      }
      const ws = new WebSocket(token.wsUrl || toWsUrl(proxy));
      this.ws = ws;
      let acknowledged = false;
      let settled = false;
      let messages = Promise.resolve();
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.cancelSocketStart === cancel) this.cancelSocketStart = null;
        if (error) reject(error);
        else resolve();
      };
      const cancel = () => finish();
      this.cancelSocketStart = cancel;
      const fail = (error: Error) => {
        if (!this.current(session) || session.failure) return;
        session.failure = error;
        if (!acknowledged) {
          finish(error);
          return;
        }
        // During microphone acquisition the start promise carries the error.
        const report = session.started;
        void this.stop();
        if (report) this.callbacks.onError(error.message);
      };
      const timeout = setTimeout(() => fail(new Error('Gemini Live setup acknowledgement timed out')), SETUP_TIMEOUT_MS);
      ws.onopen = () => {
        if (!this.current(session)) return;
        const model = token.model || (session.mode === 'translate' ? 'gemini-3.5-live-translate-preview' : 'gemini-3.5-transcribe-live');
        try {
          ws.send(JSON.stringify({ setup: geminiLiveSetup(session.mode, model, session.config.outputLanguage || 'en') }));
        } catch (error) {
          fail(error instanceof Error ? error : new Error('Gemini Live setup failed'));
        }
      };
      ws.onerror = () => fail(new Error('Gemini Live WebSocket failed'));
      ws.onclose = (event) => {
        const detail = event.reason ? `${event.code}: ${event.reason}` : String(event.code);
        fail(new Error(`Gemini Live connection closed (${detail})`));
      };
      ws.onmessage = (event) => {
        messages = messages.then(async () => {
          if (!this.current(session)) return;
          let message: GeminiMessage;
          try {
            const parsed: unknown = JSON.parse(await decodeWsData(event.data));
            if (!parsed || typeof parsed !== 'object') return;
            message = parsed as GeminiMessage;
          } catch { return; }
          if (!this.current(session)) return;
          if (message.setupComplete != null) {
            acknowledged = true;
            finish();
            return;
          }
          if (acknowledged) await this.handleMessage(message, session);
        }).catch((error: unknown) => fail(error instanceof Error ? error : new Error('Gemini Live message failed')));
      };
    });
  }

  private async startMic(session: Session): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!this.current(session)) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.mediaStream = stream;
    const audioContext = new AudioContext();
    this.audioContext = audioContext;
    if (typeof audioContext.resume === 'function') await audioContext.resume();
    if (!this.current(session)) return;
    const source = audioContext.createMediaStreamSource(stream);
    this.source = source;
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    this.processor = processor;
    const ws = this.ws;
    processor.onaudioprocess = (event) => {
      if (!this.current(session) || !ws || ws.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = floatTo16BitPcm(resample(input, audioContext.sampleRate, 16000));
      try {
        ws.send(JSON.stringify({ realtimeInput: { audio: { data: arrayBufferToBase64(pcm), mimeType: 'audio/pcm;rate=16000' } } }));
      } catch { /* The socket error/close handler reports connection failure. */ }
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
  }

  private async handleMessage(message: GeminiMessage, session: Session): Promise<void> {
    const content = message.serverContent;
    if (!content) return;
    const interim = content.interimInputTranscription;
    if (typeof interim?.text === 'string' && interim.text) {
      this.interimInput = interim.text;
      this.callbacks.onRecognizing(this.interimInput, session.mode === 'translate' ? [this.interimOutput] : [], interim.languageCode);
    }
    const output = content.outputTranscription;
    if (!this.current(session)) return;
    if (session.mode === 'translate' && typeof output?.text === 'string' && output.text) {
      this.interimOutput = output.text;
      this.callbacks.onRecognizing(this.interimInput || this.interimOutput, [this.interimOutput], output.languageCode);
    }
    const input = content.inputTranscription;
    if (typeof input?.text !== 'string' || !input.text.trim() || !this.current(session)) return;
    const original = input.text.trim();
    const primary = session.mode === 'translate' ? this.interimOutput.trim() : '';
    const translations = await this.fillTranslations(original, primary ? [primary] : [], session);
    if (!this.current(session)) return;
    this.callbacks.onRecognized(original, translations, input.languageCode);
    this.interimInput = '';
    this.interimOutput = '';
  }

  private async fillTranslations(original: string, seed: string[], session: Session): Promise<string[]> {
    const { config } = session;
    const targets = [config.outputLanguage, config.secondOutputLanguage].filter((target): target is string => Boolean(target));
    if (seed.length >= targets.length) return seed.slice(0, targets.length);
    const abort = new AbortController();
    session.translationAbort = abort;
    let rejectCancelled!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      rejectCancelled = () => reject(new Error('Translation cancelled or timed out'));
      abort.signal.addEventListener('abort', rejectCancelled, { once: true });
    });
    const timeout = setTimeout(() => abort.abort(), TRANSLATION_TIMEOUT_MS);
    try {
      const { translations } = await Promise.race([
        translateText(original, targets, config.inputLanguage, abort.signal, this.runtime),
        cancelled,
      ]);
      if (seed[0] && translations.length) translations[0] = seed[0];
      return translations;
    } catch {
      // Preserve the original utterance even when text translation is unavailable.
      return targets.map((_, index) => seed[index] ?? '');
    } finally {
      clearTimeout(timeout);
      abort.signal.removeEventListener('abort', rejectCancelled);
      if (session.translationAbort === abort) session.translationAbort = undefined;
    }
  }

  async stop(): Promise<void> {
    ++this.session;
    this.active?.translationAbort?.abort();
    this.active = null;
    this.cancelSocketStart?.();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.interimInput = '';
    this.interimOutput = '';
    const { ws, processor, source, mediaStream, audioContext } = this;
    this.ws = null;
    this.processor = null;
    this.source = null;
    this.mediaStream = null;
    this.audioContext = null;
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } catch { /* Continue releasing the microphone. */ }
      try { ws.close(); } catch { /* Already closed. */ }
    }
    if (processor) processor.onaudioprocess = null;
    try { processor?.disconnect(); } catch { /* Continue cleanup. */ }
    try { source?.disconnect(); } catch { /* Continue cleanup. */ }
    for (const track of mediaStream?.getTracks() ?? []) {
      try { track.stop(); } catch { /* Continue cleanup. */ }
    }
    try { await audioContext?.close(); } catch { /* Already closed. */ }
  }
}

function toWsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

async function decodeWsData(raw: unknown): Promise<string> {
  if (typeof raw === 'string') return raw;
  if (raw instanceof Blob) return raw.text();
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw);
  if (ArrayBuffer.isView(raw)) return new TextDecoder().decode(raw);
  return String(raw);
}
