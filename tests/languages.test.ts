import { describe, expect, it } from 'vitest';
import { isCantoneseUiCode, toGeminiLiveCode, toTranslatorCode, uniqueTargets } from '../worker/src/languages';

describe('language mapping', () => {
  it('maps Cantonese UI codes to Translator yue', () => {
    expect(toTranslatorCode('yue')).toBe('yue');
    expect(toTranslatorCode('zh-HK')).toBe('yue');
    expect(toTranslatorCode('zh-CN')).toBe('zh-Hans');
  });

  it('maps Cantonese to zh-Hant for Gemini Live Translate', () => {
    expect(toGeminiLiveCode('yue')).toBe('zh-Hant');
    expect(toGeminiLiveCode('zh-HK')).toBe('zh-Hant');
    expect(toGeminiLiveCode('zh-Hant')).toBe('zh-Hant');
  });

  it('treats yue and zh-HK as Cantonese UI codes', () => {
    expect(isCantoneseUiCode('yue')).toBe(true);
    expect(isCantoneseUiCode('zh-HK')).toBe(true);
    expect(isCantoneseUiCode('zh-TW')).toBe(false);
  });

  it('uniques mapped Cantonese codes', () => {
    expect(uniqueTargets(['yue', 'zh-HK'].map(toTranslatorCode))).toEqual(['yue']);
    expect(uniqueTargets(['yue', 'zh-CN'].map(toTranslatorCode))).toEqual(['yue', 'zh-Hans']);
  });
});
