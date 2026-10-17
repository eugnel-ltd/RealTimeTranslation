/** Map UI / Azure Speech codes onto Translator, Gemini Live Translate, and display names. */

const TRANSLATOR: Record<string, string> = {
  'en-US': 'en',
  'en-GB': 'en',
  en: 'en',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'it-IT': 'it',
  'pt-BR': 'pt',
  'ru-RU': 'ru',
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'zh-HK': 'yue',
  yue: 'yue',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
  'hi-IN': 'hi',
  'ar-SA': 'ar',
};

/** Gemini Live Translate has no `yue`; closest written form is Traditional Chinese. */
const GEMINI_LIVE: Record<string, string> = {
  ...TRANSLATOR,
  'zh-HK': 'zh-Hant',
  yue: 'zh-Hant',
  'zh-Hant': 'zh-Hant',
  'zh-Hans': 'zh-Hans',
};

export function toTranslatorCode(code: string): string {
  if (!code) return 'en';
  if (TRANSLATOR[code]) return TRANSLATOR[code];
  const base = code.split('-')[0];
  return TRANSLATOR[code] ?? TRANSLATOR[base] ?? base;
}

export function toGeminiLiveCode(code: string): string {
  if (!code) return 'en';
  return GEMINI_LIVE[code] ?? toTranslatorCode(code);
}

export function isCantoneseUiCode(code: string): boolean {
  const n = code.trim().toLowerCase();
  return n === 'yue' || n === 'zh-hk';
}

export function translationLabel(code: string): string {
  const mapped = toTranslatorCode(code);
  if (mapped === 'yue') return 'colloquial spoken Hong Kong Cantonese (口語粵語, Traditional; 嘅/咗/唔)';
  if (mapped === 'zh-Hans') return 'Mandarin Simplified Chinese (普通话 / 简体)';
  if (mapped === 'zh-Hant') return 'Traditional Chinese (繁體中文)';
  if (mapped === 'en') return 'English';
  return code;
}

export function uniqueTargets(codes: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  for (const code of codes) {
    if (!code) continue;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}
