import { describe, expect, it } from 'vitest';
import { handleTranslate } from '../worker/src/translate';
import { jsonResponse, mockEnv, mockFetch } from './helpers';

function post(body: unknown): Request {
  return new Request('https://rtt.eugnel.com/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('translate', () => {
  it('uses Azure Translator when AZURE_TRANSLATOR_KEY is set', async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toContain('api.cognitive.microsofttranslator.com/translate');
      expect(url).toContain('to=yue');
      expect(url).toContain('to=zh-Hans');
      return jsonResponse([
        {
          translations: [
            { text: '你好啊', to: 'yue' },
            { text: '你好吗', to: 'zh-Hans' },
          ],
        },
      ]);
    });
    const res = await handleTranslate(
      post({ text: 'Hello', from: 'en-US', to: ['yue', 'zh-CN'] }),
      mockEnv({ AZURE_TRANSLATOR_KEY: 'tkey', GEMINI_API_KEY: 'gkey' }),
      fetchImpl,
    );
    expect(await res.json()).toEqual({
      translations: ['你好啊', '你好吗'],
      provider: 'azure-translator',
    });
  });

  it('falls back to Gemini flash-lite when no Translator key', async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toContain('gemini-3.5-flash-lite:generateContent');
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    translations: [
                      { to: 'yue', text: '你好嗎' },
                      { to: 'zh-Hans', text: '你好吗' },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      });
    });
    const res = await handleTranslate(
      post({ text: 'Hello', to: ['zh-HK', 'zh-CN'] }),
      mockEnv({ GEMINI_API_KEY: 'gkey' }),
      fetchImpl,
    );
    expect(await res.json()).toEqual({
      translations: ['你好嗎', '你好吗'],
      provider: 'gemini',
    });
  });

  it('returns 503 when no translation provider is configured', async () => {
    const res = await handleTranslate(post({ text: 'Hello', to: ['yue'] }), mockEnv());
    expect(res.status).toBe(503);
  });
});
