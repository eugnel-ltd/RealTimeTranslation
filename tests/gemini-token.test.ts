import { describe, expect, it } from 'vitest';
import { handleGeminiToken } from '../worker/src/gemini';
import { jsonResponse, mockEnv, mockFetch } from './helpers';

describe('gemini-token', () => {
  it('mints a constrained ephemeral token and never returns GEMINI_API_KEY', async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toContain('generativelanguage.googleapis.com/v1beta/auth_tokens');
      expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('gkey');
      const body = JSON.parse(String(init?.body));
      expect(body.liveConnectConstraints.model).toContain('gemini-3.5-transcribe-live');
      return jsonResponse({ name: 'auth_tokens/abc' });
    });
    const res = await handleGeminiToken(
      new Request('https://rtt.eugnel.com/api/gemini-token?mode=transcribe'),
      mockEnv({ GEMINI_API_KEY: 'gkey' }),
      fetchImpl,
    );
    const json = (await res.json()) as { token: string; wsUrl: string };
    expect(json.token).toBe('auth_tokens/abc');
    expect(json.wsUrl).toContain('access_token=');
    expect(JSON.stringify(json)).not.toContain('gkey');
  });
});
