import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

function fixture(overrides: Record<string, unknown> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rtt-legal-'));
  const manifest = {
    id: 'rtt', name: 'Real-Time Translation', support: 'rtt@eugnel.uk',
    channels: { web: { domain: 'rtt.eugnel.com' } }, pricing: { model: 'free' },
    legal: { audience: 'general', effective: '2026-10-18',
      data: [{ category: 'Browser history', purpose: 'User-requested local history', basis: 'consent', retention: 'until deleted in this browser', linked: 'Yes' }],
      processors: [{ name: 'Example API', purpose: 'Requested translation', location: 'US' }] },
    ...overrides,
  };
  const company = { name: 'EUGNEL LTD', number: '17505169', registered_office: '122 New Road, Ascot, Berkshire, SL5 8QH',
    country: 'England and Wales', privacy_email: 'hello@eugnel.com', ico_registration: null,
    ico: { status: 'pending', application_reference: 'C2062045', expected_from: '2020-01-01' } };
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(directory, 'company.json'), JSON.stringify(company));
  const args = ['scripts/generate-legal.mjs', '--manifest', join(directory, 'manifest.json'), '--company', join(directory, 'company.json'), '--out', join(directory, 'pages')];
  return { directory, args };
}

it('generates all linked legal HTML pages with truthful pending/free/private data-use facts', () => {
  const { directory, args } = fixture();
  execFileSync(process.execPath, args);
  for (const page of ['privacy', 'terms', 'refunds', 'data-use']) {
    const html = readFileSync(join(directory, 'pages', page, 'index.html'), 'utf8');
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<main>');
    expect(html).toContain('href="/legal/privacy/"');
    expect(html).toContain('href="/legal/terms/"');
    expect(html).toContain('href="/legal/refunds/"');
    expect(html).toContain('href="/legal/data-use/"');
    expect(html).toContain('hello@eugnel.com');
    expect(html).not.toMatch(/delete your account in the app|merchant of record|registration.*ZB\d/);
  }
  const privacy = readFileSync(join(directory, 'pages/privacy/index.html'), 'utf8');
  expect(privacy).toMatch(/application.*pending/i);
  expect(privacy).toContain('C2062045');
  expect(privacy).not.toContain('2020-01-01');
  const dataUse = readFileSync(join(directory, 'pages/data-use/index.html'), 'utf8');
  expect(dataUse).toMatch(/owner|private/i);
  expect(dataUse).toMatch(/future.*transcript|transcript.*future/i);
  expect(dataUse).toMatch(/old|existing/);
  expect(dataUse).toContain('https://ai.google.dev/gemini-api/terms');
  expect(dataUse).toContain('https://typesafe.ai/legal/privacy-policy');
});

it('escapes hostile company/product strings instead of making executable policy markup', () => {
  const { directory, args } = fixture({ name: '<img src=x onerror=alert(1)>' });
  execFileSync(process.execPath, args);
  for (const page of ['privacy', 'terms', 'refunds', 'data-use']) {
    const html = readFileSync(join(directory, 'pages', page, 'index.html'), 'utf8');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
  }
});

it('fails before writing policy files when required data facts are absent', () => {
  const { directory, args } = fixture({ legal: { audience: 'general', processors: [] } });
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/legal\.data|legal\.processors/);
  expect(readdirSync(directory)).toEqual(['company.json', 'manifest.json']);
});

it('produces stable documents from the same reviewed inputs', () => {
  const { directory, args } = fixture();
  execFileSync(process.execPath, args);
  const first = readFileSync(join(directory, 'pages/privacy/index.html'), 'utf8');
  execFileSync(process.execPath, args);
  expect(readFileSync(join(directory, 'pages/privacy/index.html'), 'utf8')).toBe(first);
});
