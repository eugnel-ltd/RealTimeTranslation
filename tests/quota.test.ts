import { describe, expect, it } from 'vitest';
import { isQuotaExhaustion } from '../client/src/services/quota';

describe('isQuotaExhaustion', () => {
  it('treats TooManyRequests, Forbidden, quota, 1007, 429/403 as quota', () => {
    expect(isQuotaExhaustion({ errorCodeName: 'TooManyRequests', errorDetails: '' })).toBe(true);
    expect(isQuotaExhaustion({ errorCodeName: 'Forbidden', errorDetails: '' })).toBe(true);
    expect(isQuotaExhaustion({ errorDetails: 'quota exceeded' })).toBe(true);
    expect(isQuotaExhaustion({ errorDetails: 'websocket closed 1007' })).toBe(true);
    expect(isQuotaExhaustion({ errorDetails: 'HTTP 429' })).toBe(true);
    expect(isQuotaExhaustion({ httpStatus: 403 })).toBe(true);
  });

  it('does not treat AuthenticationFailure as quota', () => {
    expect(isQuotaExhaustion({ errorCodeName: 'AuthenticationFailure', errorDetails: '401' })).toBe(false);
    expect(isQuotaExhaustion({ errorDetails: 'AuthenticationFailure: invalid key' })).toBe(false);
  });

  it('treats a 429 at session start as quota (F0 concurrent session)', () => {
    expect(isQuotaExhaustion({ errorDetails: '429 Too Many Requests', atStart: true })).toBe(true);
  });
});
