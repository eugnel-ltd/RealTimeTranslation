import { describe, expect, it } from 'vitest';
import { toGeminiLiveCode, toTranslatorCode, uniqueTargets } from '../worker/src/languages';

describe('language mapping', () => {
  it('maps Cantonese UI codes to Translator yue', () => {
    expect(toTranslatorCode('yue')).toBe('yue');
    expect(toTranslatorCode('zh-HK')).toBe('yue');
    expect(toTranslatorCode('zh-CN')).toBe('zh-Hans');
  });

  it('maps Cantonese to zh-Hant for Gemini Live Translate', () => {
    expect(toGeminiLiveCode('yue')).toBe('zh-Hant');
    expect(toGeminiLiveCode('zh-HK')).toBe('zh-Hant');
  });

  it('uniques mapped Cantonese codes', () => {
    expect(uniqueTargets(['yue', 'zh-HK'].map(toTranslatorCode))).toEqual(['yue']);
    expect(uniqueTargets(['yue', 'zh-CN'].map(toTranslatorCode))).toEqual(['yue', 'zh-Hans']);
  });
});
