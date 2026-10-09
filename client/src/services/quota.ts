export type QuotaErrorInput = {
  errorCode?: number | string;
  errorCodeName?: string;
  errorDetails?: string;
  httpStatus?: number;
  atStart?: boolean;
};

export function isQuotaExhaustion(input: QuotaErrorInput): boolean {
  const details = (input.errorDetails ?? '').toLowerCase();
  const name = (input.errorCodeName ?? String(input.errorCode ?? '')).toLowerCase();

  if (name.includes('authenticationfailure') || details.includes('authenticationfailure')) {
    return false;
  }
  if (details.includes('authentication failed') && !details.includes('quota')) {
    return false;
  }

  if (name.includes('toomanyrequest') || name.includes('forbidden')) return true;
  if (details.includes('quota')) return true;
  if (details.includes('1007') || input.errorCode === 1007) return true;
  if (input.httpStatus === 429 || input.httpStatus === 403) return true;
  if (/\b429\b/.test(details) || /\b403\b/.test(details)) return true;
  return false;
}
