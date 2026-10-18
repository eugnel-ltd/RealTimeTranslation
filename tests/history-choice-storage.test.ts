import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

it('reports a failed durable withdrawal while honoring it in memory and preserving stored data', async () => {
  vi.resetModules();
  const old = JSON.stringify({ saveTranscriptHistory: true, extraNotes: 'Existing notes' });
  const store = new Map([['user_settings', old], ['transcriptionHistory', 'existing history']]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: () => { throw new Error('Storage full'); },
  });
  const { SettingsService } = await import('../client/src/services/settings');
  const service = SettingsService.getInstance();
  expect(() => service.updateSettings({ saveTranscriptHistory: false })).toThrow(/choice could not be saved/i);
  expect(service.getSettings().saveTranscriptHistory).toBe(false);
  expect(service.getSettings().extraNotes).toBe('Existing notes');
  expect(store.get('user_settings')).toBe(old);
  expect(store.get('transcriptionHistory')).toBe('existing history');
});
