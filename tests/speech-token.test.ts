import { describe, expect, it } from 'vitest';
import { handleSpeechToken } from '../worker/src/speech-token';
import { mockEnv, mockFetch, textResponse } from './helpers';

describe('speech-token', () => {
  it('returns 503 when Azure Speech is not configured', async () => {
    const res = await handleSpeechToken(mockEnv({ AZURE_SPEECH_KEY: undefined, AZURE_SPEECH_REGION: '' }));
    expect(res.status).toBe(503);
  });

  it('exchanges the server key at issueToken and returns {token, region}', async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe('https://eastasia.api.cognitive.microsoft.com/sts/v1.0/issueToken');
      expect((init?.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']).toBe('secret-key');
      return textResponse('ephemeral-token');
    });
    const res = await handleSpeechToken(
      mockEnv({ AZURE_SPEECH_KEY: 'secret-key', AZURE_SPEECH_REGION: 'eastasia' }),
      fetchImpl,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      token: 'ephemeral-token',
      region: 'eastasia',
      expiresIn: 600,
    });
  });
});
