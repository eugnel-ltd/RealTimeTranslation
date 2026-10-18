export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Distinguish unavailable storage from an absent or damaged saved value. */
export function readStoredJson(key: string): { available: boolean; value: unknown } {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return { available: false, value: undefined };
  }
  try {
    return { available: true, value: raw === null ? undefined : JSON.parse(raw) };
  } catch {
    return { available: true, value: undefined };
  }
}

export function writeStoredJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
