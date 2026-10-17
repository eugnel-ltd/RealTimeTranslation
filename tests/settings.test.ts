/// <reference path="../client/src/vite-env.d.ts" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadSettings(saved: Record<string, unknown> | null) {
  const store = new Map(saved ? [['user_settings', JSON.stringify(saved)]] : []);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  const { SettingsService } = await import('../client/src/services/settings');
  return SettingsService.getInstance().getSettings();
}

describe('saved answer model settings', () => {
  it('uses Gemini Flash by default', async () => {
    expect((await loadSettings(null)).answerModel).toBe('gemini-3.8-flash');
  });

  it.each(['opus-5-5', 'sonnet-5-5'])('replaces a saved legacy %s model with Gemini Flash', async (suffix) => {
    const legacyModel = ['claude', suffix].join('-');
    const settings = await loadSettings({ answerModel: legacyModel, userContext: 'Keep my notes' });
    expect(settings.answerModel).toBe('gemini-3.8-flash');
    expect(settings.userContext).toBe('Keep my notes');
  });

  it.each(['unsupported', '', null, undefined])('replaces an invalid saved model %s with Gemini Flash', async (answerModel) => {
    expect((await loadSettings({ answerModel })).answerModel).toBe('gemini-3.8-flash');
  });

  it.each(['gemini-3.8-flash', 'gemini-3.5-flash-lite'])('preserves the saved allowed model %s', async (answerModel) => {
    expect((await loadSettings({ answerModel })).answerModel).toBe(answerModel);
  });
});
