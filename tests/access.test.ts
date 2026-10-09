import { describe, expect, it } from 'vitest';
import { isApiPath, requireAccess } from '../worker/src/access';
import { mockEnv } from './helpers';

describe('access', () => {
  it('matches /api routes', () => {
    expect(isApiPath('/api/speech-token')).toBe(true);
    expect(isApiPath('/api/profiles')).toBe(true);
    expect(isApiPath('/api/profiles/james')).toBe(true);
    expect(isApiPath('/index.html')).toBe(false);
  });

  it('skips verification when SKIP_ACCESS_CHECK is true', async () => {
    const denied = await requireAccess(new Request('https://rtt.eugnel.com/api/health'), mockEnv());
    expect(denied).toBeNull();
  });

  it('fails closed with 500 when ACCESS_AUD is empty', async () => {
    const denied = await requireAccess(
      new Request('https://rtt.eugnel.com/api/health'),
      mockEnv({ SKIP_ACCESS_CHECK: 'false', ACCESS_AUD: '' }),
    );
    expect(denied?.status).toBe(500);
    expect(await denied!.json()).toEqual({ error: 'ACCESS_AUD not configured' });
  });

  it('fails closed when ACCESS_AUD is only whitespace', async () => {
    const denied = await requireAccess(
      new Request('https://rtt.eugnel.com/api/health'),
      mockEnv({ SKIP_ACCESS_CHECK: 'false', ACCESS_AUD: '   ' }),
    );
    expect(denied?.status).toBe(500);
  });

  it('rejects missing Access JWT', async () => {
    const denied = await requireAccess(
      new Request('https://rtt.eugnel.com/api/health'),
      mockEnv({ SKIP_ACCESS_CHECK: 'false', ACCESS_AUD: 'aud' }),
    );
    expect(denied?.status).toBe(403);
    const body = (await denied!.json()) as { error: string };
    expect(body.error).toMatch(/Missing Cf-Access-Jwt-Assertion/);
  });
});
