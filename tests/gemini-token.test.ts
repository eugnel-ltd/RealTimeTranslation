import { describe, expect, it } from 'vitest';
import { geminiLiveSetup } from '../shared/geminiLive';
import { geminiLiveSession, handleGeminiToken, handleGeminiLiveProxy } from '../worker/src/gemini';
import { jsonResponse, mockEnv, mockFetch } from './helpers';

describe('gemini-token', () => {
  it('mints a constrained ephemeral token with bidiGenerateContentSetup', async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toContain('generativelanguage.googleapis.com/v1beta/auth_tokens');
      expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('gkey');
      const body = JSON.parse(String(init?.body));
      expect(body.liveConnectConstraints).toBeUndefined();
      expect(body.bidiGenerateContentSetup.model).toContain('gemini-3.5-transcribe-live');
      expect(body.bidiGenerateContentSetup.generationConfig.responseModalities).toEqual(['TEXT']);
      expect(body.bidiGenerateContentSetup.inputAudioTranscription).toEqual({ languageCodes: [] });
      return jsonResponse({ name: 'auth_tokens/abc' });
    });
    const res = await handleGeminiToken(
      new Request('https://rtt.eugnel.com/api/gemini-token?mode=transcribe'),
      mockEnv({ GEMINI_API_KEY: 'gkey' }),
      fetchImpl,
    );
    const json = (await res.json()) as { token: string; wsUrl: string };
    expect(json.token).toBe('auth_tokens/abc');
    expect(json.wsUrl).toContain('access_token=');
    expect(JSON.stringify(json)).not.toContain('gkey');
  });

  it('puts translate transcription fields on setup, translationConfig in generationConfig', async () => {
    const fetchImpl = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      const setup = body.bidiGenerateContentSetup;
      expect(setup.generationConfig.translationConfig.targetLanguageCode).toBe('zh-Hant');
      expect(setup.generationConfig.inputAudioTranscription).toBeUndefined();
      expect(setup.inputAudioTranscription).toEqual({});
      expect(setup.outputAudioTranscription).toEqual({});
      return jsonResponse({ name: 'auth_tokens/tr' });
    });
    const res = await handleGeminiToken(
      new Request('https://rtt.eugnel.com/api/gemini-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'translate', targetLanguage: 'yue' }),
      }),
      mockEnv({ GEMINI_API_KEY: 'gkey' }),
      fetchImpl,
    );
    expect(res.ok).toBe(true);
  });

  it('returns 426 without Upgrade', async () => {
    const res = await handleGeminiLiveProxy(
      new Request('https://rtt.eugnel.com/api/gemini-live'),
      mockEnv({ GEMINI_API_KEY: 'gkey' }),
    );
    expect(res.status).toBe(426);
  });
});

describe('gemini live setup shape', () => {
  it('keeps input/output transcription off generationConfig for translate', () => {
    const setup = geminiLiveSetup('translate', 'gemini-3.5-live-translate-preview', 'yue');
    const gen = setup.generationConfig as Record<string, unknown>;
    expect(gen.translationConfig).toEqual({
      targetLanguageCode: 'zh-Hant',
      echoTargetLanguage: false,
    });
    expect(gen.inputAudioTranscription).toBeUndefined();
    expect(gen.outputAudioTranscription).toBeUndefined();
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.outputAudioTranscription).toEqual({});
  });

  it('maps Cantonese targets for a translate session', () => {
    const { setup } = geminiLiveSession(mockEnv(), 'translate', 'zh-HK');
    const gen = setup.generationConfig as { translationConfig: { targetLanguageCode: string } };
    expect(gen.translationConfig.targetLanguageCode).toBe('zh-Hant');
  });
});
