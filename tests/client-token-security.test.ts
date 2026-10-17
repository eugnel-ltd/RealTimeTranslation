import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Point CLIENT_SOURCE_DIR at a git-show snapshot to run these assertions on old sources.
const sourceDir = process.env.CLIENT_SOURCE_DIR || 'client/src';
function sourcePaths(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourcePaths(path) : /\.[jt]sx?$/.test(path) ? [path] : [];
  });
}
const sources = sourcePaths(sourceDir).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe(`client token security (${sourceDir})`, () => {
  it('contains no provider key use in client/src', () => {
    const forbidden = /\bfromSubscription\s*\(|\b(?:VITE_)?(?:AZURE_)?SPEECH_KEY\b|\b(?:VITE_)?(?:GEMINI|ANTHROPIC|AZURE_TRANSLATOR|TYPESAFE)_API_KEY\b/g;
    // Report identifiers and paths only, never source lines that might hold a key.
    const violations = sources.flatMap(({ path, text }) => [...text.matchAll(forbidden)].map((match) => `${path}: ${match[0]}`));
    expect(violations, 'Provider keys must stay in the Worker').toEqual([]);
  });
  it('uses the Worker speech token endpoint and token-based SDK configuration', () => {
    const combined = sources.map((source) => source.text).join('\n');
    expect(combined.includes('/api/speech-token'), 'Client must use /api/speech-token').toBe(true);
    expect(combined.includes('fromAuthorizationToken('), 'Azure SDK must use an authorisation token').toBe(true);
  });
});
