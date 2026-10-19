import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { companyFooterLine } from '../scripts/legal-company-lines.mjs';

const FOOTER_LINE =
  'EUGNEL LTD · Registered in England & Wales · Company no. 17505169 · Registered office: 122 New Road, Ascot, SL5 8QH · hello@eugnel.com';
function fixture(overrides: Record<string, unknown> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rtt-legal-'));
  const manifest = {
    id: 'rtt', name: 'Real-Time Translation', support: 'rtt@eugnel.uk',
    channels: { web: { domain: 'rtt.eugnel.com' } }, pricing: { model: 'free' },
    legal: { audience: 'general', effective: '2026-10-19',
      data: [{ category: 'Browser history', purpose: 'User-requested local history', basis: 'consent', retention: 'until deleted in this browser', linked: 'Yes' }],
      processors: [{ name: 'Example API', purpose: 'Requested translation', location: 'US' }] },
    ...overrides,
  };
  const company = {
    name: 'EUGNEL LTD', number: '17505169', registered_office: '122 New Road, Ascot, SL5 8QH',
    country: 'England and Wales', privacy_email: 'hello@eugnel.com', ico_registration: 'ZC277339',
    ico: { status: 'registered' },
  };
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(directory, 'company.json'), JSON.stringify(company));
  const args = ['scripts/generate-legal.mjs', '--manifest', join(directory, 'manifest.json'), '--company', join(directory, 'company.json'), '--out', join(directory, 'pages')];
  return { directory, args, company };
}

it('generates all linked legal HTML pages with registered ICO, footer line and short company body', () => {
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
    expect(html).toContain('Registered in England &amp; Wales · Company no. 17505169 · Registered office: 122 New Road, Ascot, SL5 8QH');
    expect(html).not.toMatch(/delete your account in the app|merchant of record|Berkshire/);
  }
  const privacy = readFileSync(join(directory, 'pages/privacy/index.html'), 'utf8');
  expect(privacy).toContain('Information Commission (ICO), registration number ZC277339');
  expect(privacy).toContain('Information Commission (ICO)');
  expect(privacy).toContain('https://ico.org.uk/make-a-complaint/');
  expect(privacy).toMatch(/section 164A of the Data Protection Act 2018/);
  expect(privacy).toMatch(/acknowledge your complaint within 30 days/i);
  expect(privacy).toContain('EUGNEL LTD, registered in England &amp; Wales, company no. 17505169 · hello@eugnel.com');
  const privacyMain = privacy.match(/<main>([\s\S]*)<\/main>/)?.[1] ?? '';
  expect(privacyMain).not.toContain('122 New Road, Ascot, SL5 8QH');
  expect(privacy).not.toMatch(/application.*pending/i);
  expect(privacy).not.toContain('C2062045');
  expect(privacy).not.toContain('Information Commissioner&#39;s Office');
  const dataUse = readFileSync(join(directory, 'pages/data-use/index.html'), 'utf8');
  expect(dataUse).toMatch(/owner|private/i);
  expect(dataUse).toMatch(/future.*transcript|transcript.*future/i);
  expect(dataUse).toMatch(/old|existing/);
  expect(dataUse).toContain('https://ai.google.dev/gemini-api/terms');
  expect(dataUse).toContain('https://typesafe.ai/legal/privacy-policy');
});

it('derives the site footer line from the company snapshot fields', () => {
  const { company } = fixture();
  expect(companyFooterLine(company)).toBe(FOOTER_LINE);
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
