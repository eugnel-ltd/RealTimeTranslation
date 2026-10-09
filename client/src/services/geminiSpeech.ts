import { geminiLiveSetup } from '../../../shared/geminiLive';
import { fetchGeminiToken, translateText, type GeminiToken } from './api';
import { arrayBufferToBase64, floatTo16BitPcm, resample } from './pcm';
import type { TranslationConfig } from './azureSpeech';

type SpeechCallbacks = {
  onRecognizing: (original: string, translations: string[], detectedLanguage?: string) => void;
  onRecognized: (original: string, translations: string[], detectedLanguage?: string) => void;
  onError: (error: string) => void;
};

type GeminiMode = 'transcribe' | 'translate';

export class GeminiSpeechService {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mediaStream: MediaStream | null = null;
  private running = false;
  private config: TranslationConfig | null = null;
  private mode: GeminiMode = 'transcribe';
  private interimInput = '';
  private interimOutput = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly callbacks: SpeechCallbacks) {}

  async start(config: TranslationConfig, mode: GeminiMode) {
    await this.stop();
    this.config = config;
    this.mode = mode;
    this.running = true;
    await this.openSession();
  }

  private async openSession() {
    if (!this.config || !this.running) return;
    const token = await this.mintToken();
    await this.openSocket(token);
    await this.startMic();
    this.scheduleReconnect();
  }

  private async mintToken(): Promise<GeminiToken> {
    try {
      return await fetchGeminiToken(this.mode, this.config?.outputLanguage);
    } catch (err) {
      console.warn('Gemini ephemeral token failed, using Worker proxy', err);
      const target = this.config?.outputLanguage
        ? `&target=${encodeURIComponent(this.config.outputLanguage)}`
        : '';
      return {
        token: '',
        expireTime: '',
        model: '',
        mode: this.mode,
        wsUrl: '',
        proxyUrl: `/api/gemini-live?mode=${this.mode}${target}`,
      };
    }
  }

  private openSocket(token: GeminiToken): Promise<void> {
    const url = token.wsUrl || toWsUrl(token.proxyUrl);
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        ws.send(JSON.stringify({ setup: this.setupMessage() }));
        resolve();
      };
      ws.onerror = () => {
        if (!opened) reject(new Error('Gemini Live WebSocket failed'));
      };
      ws.onclose = (event) => {
        if (this.running) {
          const detail = event.reason ? `${event.code}: ${event.reason}` : String(event.code);
          this.callbacks.onError(`Gemini Live connection closed (${detail})`);
        }
      };
      ws.onmessage = (event) => {
        void this.handleMessage(event.data);
      };
    });
  }

  private setupMessage(): Record<string, unknown> {
    if (this.mode === 'translate') {
      return geminiLiveSetup(
        'translate',
        'gemini-3.5-live-translate-preview',
        this.config?.outputLanguage || 'en',
      );
    }
    return geminiLiveSetup('transcribe', 'gemini-3.5-transcribe-live');
  }

  private async startMic() {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContext();
    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const resampled = resample(input, this.audioContext?.sampleRate ?? 48000, 16000);
      const pcm = floatTo16BitPcm(resampled);
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: { data: arrayBufferToBase64(pcm), mimeType: 'audio/pcm;rate=16000' },
          },
        }),
      );
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  private async handleMessage(raw: unknown) {
    const text = await decodeWsData(raw);
    let msg: {
      serverContent?: {
        interimInputTranscription?: { text?: string; languageCode?: string };
        inputTranscription?: { text?: string; languageCode?: string };
        outputTranscription?: { text?: string; languageCode?: string };
        generationComplete?: boolean;
      };
    };
    try {
      msg = JSON.parse(text) as typeof msg;
    } catch {
      return;
    }
    const content = msg.serverContent;
    if (!content) return;

    if (content.interimInputTranscription?.text) {
      this.interimInput = content.interimInputTranscription.text;
      this.callbacks.onRecognizing(this.interimInput, this.mode === 'translate' ? [this.interimOutput] : [], content.interimInputTranscription.languageCode);
    }
    if (this.mode === 'translate' && content.outputTranscription?.text) {
      this.interimOutput = content.outputTranscription.text;
      this.callbacks.onRecognizing(this.interimInput || this.interimOutput, [this.interimOutput], content.outputTranscription.languageCode);
    }
    if (content.inputTranscription?.text) {
      const original = content.inputTranscription.text.trim();
      if (!original) return;
      const detected = content.inputTranscription.languageCode;
      if (this.mode === 'translate') {
        const primary = (content.outputTranscription?.text || this.interimOutput || '').trim();
        const translations = await this.fillTranslations(original, primary ? [primary] : []);
        this.callbacks.onRecognized(original, translations, detected);
      } else {
        const translations = await this.fillTranslations(original, []);
        this.callbacks.onRecognized(original, translations, detected);
      }
      this.interimInput = '';
      this.interimOutput = '';
    }
  }

  private async fillTranslations(original: string, seed: string[]): Promise<string[]> {
    const targets = [this.config?.outputLanguage, this.config?.secondOutputLanguage].filter(
      (x): x is string => Boolean(x),
    );
    if (targets.length === 0) return seed;
    if (seed.length >= targets.length) return seed.slice(0, targets.length);
    try {
      const { translations } = await translateText(original, targets, this.config?.inputLanguage);
      if (seed[0] && translations.length) {
        translations[0] = seed[0];
      }
      return translations;
    } catch (err) {
      console.error('translate failed', err);
      return seed.length ? seed : targets.map(() => '');
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.running) return;
      void this.recycle();
    }, 8 * 60 * 1000);
  }

  private async recycle() {
    this.teardownSocketAndMic();
    try {
      await this.openSession();
    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err.message : 'Gemini reconnect failed');
    }
  }

  async stop() {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } catch {
        /* ignore */
      }
    }
    this.teardownSocketAndMic();
  }

  private teardownSocketAndMic() {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    void this.audioContext?.close();
    this.processor = null;
    this.source = null;
    this.mediaStream = null;
    this.audioContext = null;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
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
  return String(raw);
}
