/**
 * Application configuration.
 * API calls use same-origin `/api/*` so secrets never enter this bundle.
 */
export const config = {
  server: {
    apiUrl: '',
    wsUrl: '',
  },
  
  defaultSettings: {
    inputLanguage: import.meta.env.VITE_DEFAULT_INPUT_LANGUAGE || 'en-US',
    outputLanguage: import.meta.env.VITE_DEFAULT_OUTPUT_LANGUAGE || 'yue',
    secondOutputLanguage: import.meta.env.VITE_DEFAULT_SECOND_OUTPUT_LANGUAGE || '',
  },

  ui: {
    appName: import.meta.env.VITE_APP_NAME || 'Real Time Translation',
    defaultTheme: import.meta.env.VITE_DEFAULT_THEME || 'light',
  },

  // Supported languages configuration
  languages: [
    { code: 'auto', name: 'Auto Detect', nativeName: 'Auto Detect' },
    { code: '', name: 'None', nativeName: 'None' },
    { code: 'en-US', name: 'English (US)', nativeName: 'English (US)' },
    { code: 'en-GB', name: 'English (UK)', nativeName: 'English (UK)' },
    { code: 'es-ES', name: 'Spanish', nativeName: 'Español' },
    { code: 'fr-FR', name: 'French', nativeName: 'Français' },
    { code: 'de-DE', name: 'German', nativeName: 'Deutsch' },
    { code: 'it-IT', name: 'Italian', nativeName: 'Italiano' },
    { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)' },
    { code: 'ru-RU', name: 'Russian', nativeName: 'Русский' },
    { code: 'zh-CN', name: 'Simplified Chinese', nativeName: '简体中文' },
    { code: 'zh-TW', name: 'Traditional Chinese', nativeName: '繁體中文' },
    { code: 'zh-HK', name: 'Cantonese', nativeName: '粵語' },
    { code: 'ja-JP', name: 'Japanese', nativeName: '日本語' },
    { code: 'ko-KR', name: 'Korean', nativeName: '한국어' },
  ] as const,
} as const;

// Type for language codes
export type LanguageCode = typeof config.languages[number]['code'];

// Utility function to validate language code
export function isValidLanguage(code: string): code is LanguageCode {
  return config.languages.some(lang => lang.code === code);
}

// Export default configuration
export default config;
