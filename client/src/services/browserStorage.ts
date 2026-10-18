export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export type StorageIdentity = Readonly<{ productId: string; environment: string; origin: string; accountId: string }>;
export interface StorageScope {
  readonly active: boolean;
  readonly accountId?: string;
  key(key: string): string;
  getItem(key: string): string | null;
  setItem(key: string, value: string): boolean;
  revoke(): void;
  clearConfirmedAccountCache(): boolean;
}

/** Construct only after server verification. The captured prefix never changes. */
export function createStorageScope(identity?: StorageIdentity): StorageScope {
  if (identity && (identity.productId !== 'rtt' || !/^[A-Za-z0-9_-]{1,128}$/.test(identity.environment) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(identity.accountId) || new URL(identity.origin).origin !== identity.origin)) {
    throw new Error('Invalid account storage scope');
  }
  const prefix = identity ? `rtt:account:v1:${encodeURIComponent(JSON.stringify([
    identity.productId, identity.environment, identity.origin, identity.accountId,
  ]))}:` : '';
  let active = true;
  const key = (name: string) => `${prefix}${name}`;
  return Object.freeze({
    accountId: identity?.accountId,
    get active() { return active; }, key,
    getItem(name: string) { return active ? localStorage.getItem(key(name)) : null; },
    setItem(name: string, value: string) {
      if (!active) return false;
      try { localStorage.setItem(key(name), value); return true; } catch { return false; }
    },
    revoke() { active = false; },
    clearConfirmedAccountCache() {
      if (!prefix) return false;
      try {
        for (const name of ['user_settings', 'transcriptionHistory', 'rtt_azure_quota_fallback_month']) localStorage.removeItem(key(name));
        return true;
      } catch { return false; }
    },
  });
}

/** Distinguish unavailable storage from an absent or damaged saved value. */
export function readStoredJson(key: string, storage?: StorageScope): { available: boolean; value: unknown } {
  if (storage && !storage.active) return { available: false, value: undefined };
  let raw: string | null;
  try {
    raw = storage ? storage.getItem(key) : localStorage.getItem(key);
  } catch {
    return { available: false, value: undefined };
  }
  try {
    return { available: true, value: raw === null ? undefined : JSON.parse(raw) };
  } catch {
    return { available: true, value: undefined };
  }
}

export function writeStoredJson(key: string, value: unknown, storage?: StorageScope): boolean {
  if (storage) return storage.setItem(key, JSON.stringify(value));
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
