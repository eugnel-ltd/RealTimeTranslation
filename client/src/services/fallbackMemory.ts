import { currentUtcMonth } from './month';
import type { StorageScope } from './browserStorage';

const FALLBACK_MONTH_KEY = 'rtt_azure_quota_fallback_month';

export function rememberQuotaFallbackForMonth(storage?: StorageScope): void {
  if (storage) { storage.setItem(FALLBACK_MONTH_KEY, currentUtcMonth()); return; }
  localStorage.setItem(FALLBACK_MONTH_KEY, currentUtcMonth());
}

export function shouldPreferFallbackThisMonth(storage?: StorageScope): boolean {
  if (storage && !storage.active) return false;
  return (storage ? storage.getItem(FALLBACK_MONTH_KEY) : localStorage.getItem(FALLBACK_MONTH_KEY)) === currentUtcMonth();
}
