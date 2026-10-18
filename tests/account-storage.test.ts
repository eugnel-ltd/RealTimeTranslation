import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as browserStorage from '../client/src/services/browserStorage';
import { SettingsService } from '../client/src/services/settings';
import { loadTranscriptHistory, persistTranscriptEntries } from '../client/src/services/transcriptHistory';
import * as fallback from '../client/src/services/fallbackMemory';
import type { TranscriptEntry } from '../client/src/types';

export type Identity = { productId: string; environment: string; origin: string; accountId: string };
export type StorageScope = {
  readonly active: boolean;
  key(key: string): string;
  getItem(key: string): string | null;
  setItem(key: string, value: string): boolean;
  revoke(): void;
  clearConfirmedAccountCache(): boolean;
};

/** Before the new scope API exists, adapt the actual original unscoped storage.
 * This makes first-red prove shared keys/stale writes, rather than a missing export. */
export function scope(identity?: Identity): StorageScope {
  const factory: unknown = Reflect.get(browserStorage, 'createStorageScope');
  if (typeof factory === 'function') return (factory as (identity?: Identity) => StorageScope)(identity);
  return {
    active: true, key: (key) => key,
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => { localStorage.setItem(key, value); return true; },
    revoke() {}, clearConfirmedAccountCache() { return true; },
  };
}

const identity: Identity = { productId: 'rtt', environment: 'development', origin: 'https://rtt.example.test', accountId: 'account_A' };
let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('captures independent account, environment and origin keys without adopting owner data', () => {
  stored.set('user_settings', 'owner settings');
  const a = scope(identity);
  const b = scope({ ...identity, accountId: 'account_B' });
  const stage = scope({ ...identity, environment: 'staging' });
  const origin = scope({ ...identity, origin: 'https://other.example.test' });
  expect(a.getItem('user_settings'), 'account A must never adopt unassigned owner data').toBeNull();
  a.setItem('user_settings', 'A'); b.setItem('user_settings', 'B');
  expect(a.getItem('user_settings'), 'account B must not overwrite captured account A').toBe('A');
  expect(stage.getItem('user_settings')).toBeNull();
  expect(origin.getItem('user_settings')).toBeNull();
  expect(stored.get('user_settings')).toBe('owner settings');
});

it('revokes captured storage synchronously, including callbacks retained by an old account', () => {
  const a = scope(identity); a.setItem('user_settings', 'A');
  const lateSave = () => a.setItem('user_settings', 'stale');
  a.revoke();
  expect(a.active).toBe(false);
  expect(lateSave(), 'revoked scopes must refuse late persistence').toBe(false);
  expect(a.getItem('user_settings')).toBeNull();
  expect(stored.get(a.key('user_settings'))).toBe('A');
});

it('erases only the exact captured account cache after confirmation, preserving legacy and another account', () => {
  const a = scope(identity); const b = scope({ ...identity, accountId: 'account_B' });
  for (const key of ['user_settings', 'transcriptionHistory', 'rtt_azure_quota_fallback_month']) {
    stored.set(key, 'owner'); a.setItem(key, 'A'); b.setItem(key, 'B');
  }
  a.setItem('unrelated', 'keep'); a.revoke();
  expect(a.clearConfirmedAccountCache()).toBe(true);
  for (const key of ['user_settings', 'transcriptionHistory', 'rtt_azure_quota_fallback_month']) {
    expect(stored.has(a.key(key)), 'confirmed erasure removes only known account cache keys').toBe(false);
    expect(stored.get(b.key(key))).toBe('B'); expect(stored.get(key)).toBe('owner');
  }
  expect(stored.get(a.key('unrelated'))).toBe('keep');
});

it('threads captured scopes through actual settings, transcript history and quota fallback consumers', () => {
  const a = scope(identity); const b = scope({ ...identity, accountId: 'account_B' });
  const factory: unknown = Reflect.get(SettingsService, 'forStorage');
  const settings = typeof factory === 'function'
    ? (factory as (storage: StorageScope) => SettingsService)(a) : SettingsService.getInstance();
  settings.updateSettings({ userContext: 'A private context', saveTranscriptHistory: true });
  const record: TranscriptEntry = {
    id: 'record_A', sessionId: 'session_A', sessionTimestamp: '2026-10-18T12:00:00.000Z',
    timestamp: '2026-10-18T12:00:00.000Z', original: 'A private transcript', translations: [],
    sourceLanguage: 'en-US', targetLanguages: ['en'], isFinal: true, isSaved: false,
  };
  (persistTranscriptEntries as (entries: TranscriptEntry[], storage: StorageScope) => string[])([record], a);
  (fallback.rememberQuotaFallbackForMonth as (storage: StorageScope) => void)(a);
  expect((loadTranscriptHistory as (storage: StorageScope) => unknown[])(b), 'account B must not read A transcript history').toEqual([]);
  expect((fallback.shouldPreferFallbackThisMonth as (storage: StorageScope) => boolean)(b)).toBe(false);
  expect(stored.has('user_settings'), 'account settings must leave owner settings unassigned').toBe(false);
  expect(stored.get(a.key('user_settings'))).toContain('A private context');
});

it('retains explicit owner-mode compatibility without deleting unassigned data', () => {
  const owner = scope(); owner.setItem('user_settings', 'owner'); owner.revoke();
  expect(owner.clearConfirmedAccountCache(), 'owner data has no verified account erasure authority').toBe(false);
  expect(stored.get('user_settings')).toBe('owner');
});
