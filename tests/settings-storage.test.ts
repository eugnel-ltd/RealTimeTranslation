import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

async function service(raw: string | null, blocked = false) {
  vi.stubGlobal('localStorage', {
    getItem: () => { if (blocked) throw new Error('Storage blocked'); return raw; },
    setItem: () => { if (blocked) throw new Error('Storage blocked'); },
  });
  const { SettingsService } = await import('../client/src/services/settings');
  return SettingsService.getInstance();
}

it.each(['{', 'null', '42', '"wrong"', '[]'])('uses defaults when saved settings are %s', async (raw) => {
  const settings = (await service(raw)).getSettings();
  expect(settings.inputLanguage).toBe('en-US');
  expect(settings.outputLanguage).toBe('yue');
  expect(settings.hotkeys.toggleRecording).toBe('KeyR');
});

it('validates fields instead of spreading wrong-shaped settings into the live app', async () => {
  const settings = (await service(JSON.stringify({
    inputLanguage: null, outputLanguage: ['en-US'], secondOutputLanguage: {},
    theme: 'invalid', speechEngine: 'invalid', splitLayout: 'invalid',
    userContext: {}, extraNotes: false, hotkeys: { toggleRecording: null, clear: 17 },
    autoDetect: 'false', showAiAnswer: false, answerLanguage: 'invalid',
    answerWindowSeconds: 7, questionThreshold: null, profileId: 'invalid',
  }))).getSettings();
  expect(settings.inputLanguage).toBe('en-US');
  expect(settings.outputLanguage).toBe('yue');
  expect(settings.secondOutputLanguage).toBe('');
  expect(settings.theme).toBe('light');
  expect(settings.speechEngine).toBe('auto');
  expect(settings.splitLayout).toBe('transcript-left');
  expect(settings.userContext).toBe('');
  expect(settings.extraNotes).toBe('');
  expect(settings.hotkeys.toggleRecording).toBe('KeyR');
  expect(settings.hotkeys.clear).toBe('KeyX');
  expect(settings.autoDetect).toBe(true);
  expect(settings.showAiAnswer).toBe(false);
  expect(settings.answerLanguage).toBe('same');
});

it('keeps settings usable in memory when browser storage throws on read and write', async () => {
  const settings = await service(null, true);
  expect(() => settings.updateSettings({ outputLanguage: 'fr-FR', userContext: 'Keep this' })).not.toThrow();
  expect(settings.getSettings().outputLanguage).toBe('fr-FR');
  expect(settings.getSettings().userContext).toBe('Keep this');
  expect(() => settings.resetToDefaults()).not.toThrow();
  expect(settings.getSettings().outputLanguage).toBe('yue');
});

it('keeps validated legacy notes, valid language selections and custom hotkeys', async () => {
  const settings = (await service(JSON.stringify({
    inputLanguage: 'auto', outputLanguage: 'fr-FR', secondOutputLanguage: 'ja-JP',
    cvBackground: 'Legacy notes', hotkeys: { toggleRecording: 'Control+KeyR' },
  }))).getSettings();
  expect(settings.inputLanguage).toBe('auto');
  expect(settings.outputLanguage).toBe('fr-FR');
  expect(settings.secondOutputLanguage).toBe('ja-JP');
  expect(settings.extraNotes).toBe('Legacy notes');
  expect(settings.hotkeys.toggleRecording).toBe('Control+KeyR');
});
