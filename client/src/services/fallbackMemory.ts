import { currentUtcMonth } from './month';

const FALLBACK_MONTH_KEY = 'rtt_azure_quota_fallback_month';

export function rememberQuotaFallbackForMonth(): void {
  localStorage.setItem(FALLBACK_MONTH_KEY, currentUtcMonth());
}

export function shouldPreferFallbackThisMonth(): boolean {
  return localStorage.getItem(FALLBACK_MONTH_KEY) === currentUtcMonth();
}
