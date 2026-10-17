import { describe, expect, it } from 'vitest';
import {
  evaluateSystemOne,
  TypesafeHttpError,
  TypesafeTimeoutError,
} from '../worker/src/typesafe';
import { jsonResponse, mockFetch, textResponse } from './helpers';

describe('evaluateSystemOne', () => {
  it('retries once on 429 then throws', async () => {
    let n = 0;
    const fetchImpl = mockFetch(() => {
      n += 1;
      return textResponse('rate limited', 429);
    });
    await expect(
      evaluateSystemOne('k', { state: {}, model: 'jev-latest', questions: {} }, fetchImpl, 200, 1),
    ).rejects.toBeInstanceOf(TypesafeHttpError);
    expect(n).toBe(2);
  });

  it('times out and retries, then throws TypesafeTimeoutError', async () => {
    let n = 0;
    const fetchImpl = mockFetch(() => {
      n += 1;
      return new Promise(() => undefined) as unknown as Response;
    });
    await expect(
      evaluateSystemOne('k', { state: {}, model: 'jev-latest', questions: {} }, fetchImpl, 40, 1),
    ).rejects.toBeInstanceOf(TypesafeTimeoutError);
    expect(n).toBe(2);
  });

  it('does not retry 401', async () => {
    let n = 0;
    const fetchImpl = mockFetch(() => {
      n += 1;
      return textResponse('nope', 401);
    });
    await expect(
      evaluateSystemOne('k', { state: {}, model: 'jev-latest', questions: {} }, fetchImpl, 200, 1),
    ).rejects.toBeInstanceOf(TypesafeHttpError);
    expect(n).toBe(1);
  });

  it('returns JSON on success', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ model: 'jev-latest', answers: {} }));
    const out = await evaluateSystemOne('k', { state: {}, model: 'jev-latest', questions: {} }, fetchImpl, 200, 1);
    expect(out.model).toBe('jev-latest');
  });
});
