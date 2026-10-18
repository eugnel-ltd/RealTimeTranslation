import { describe, expect, it } from 'vitest';
import { handleHealth } from '../worker/src/observability';
import { mockEnv } from './helpers';
import manifest from '../package.json';

describe('release identity in authenticated health', () => {
  it('reports the exact configured reviewed commit', async () => {
    const sha = 'a'.repeat(40);
    const response = await handleHealth(Object.assign(mockEnv({ GEMINI_API_KEY: 'test-key' }), { DEPLOYMENT_SHA: sha }));
    expect(await response.json()).toMatchObject({ product: 'rtt', version: `${manifest.version}+${sha}` });
  });

  it.each([undefined, 'untrusted-version', 'a'.repeat(39)])('uses the package version for invalid identity %s', async (sha) => {
    const response = await handleHealth(Object.assign(mockEnv({ GEMINI_API_KEY: 'test-key' }), { DEPLOYMENT_SHA: sha }));
    expect(await response.json()).toMatchObject({ version: manifest.version });
  });
});
