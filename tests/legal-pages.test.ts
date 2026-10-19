import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { companyTradingDisclosureText } from '../scripts/legal-company-lines.mjs';

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
  const pagesDir = join(directory, 'pages');
  const companyDir = join(directory, 'company');
  const args = [
    'scripts/generate-legal.mjs',
    '--manifest', join(directory, 'manifest.json'),
    '--company', join(directory, 'company.json'),
    '--out', pagesDir,
    '--company-out', companyDir,
  ];
  return { directory, pagesDir, companyDir, args, company };
}

it('exposes full trader disclosure text for any future checkout or order-confirmation email', () => {
  const { company } = fixture();
  const disclosure = companyTradingDisclosureText(company);
  expect(disclosure).toContain('17505169');
  expect(disclosure).toContain('122 New Road, Ascot, SL5 8QH');
  expect(disclosure).toContain('hello@eugnel.com');
  expect(disclosure).toContain('ZC277339');
});

function mainHtml(html: string) {
  return html.match(/<main>([\s\S]*)<\/main>/)?.[1] ?? '';
}

it('generates legal pages with a minimal site footer, company page, and policy bodies without address or company number', () => {
  const { pagesDir, companyDir, args } = fixture();
  execFileSync(process.execPath, args);
  for (const page of ['privacy', 'terms', 'refunds', 'data-use']) {
    const html = readFileSync(join(pagesDir, page, 'index.html'), 'utf8');
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('© EUGNEL LTD');
    expect(html).toContain('href="/company/">Company information</a>');
    expect(html).toContain('href="/legal/privacy/"');
    expect(html).toContain('hello@eugnel.com');
  }
  for (const page of ['privacy', 'terms', 'refunds'] as const) {
    const policyMain = mainHtml(readFileSync(join(pagesDir, page, 'index.html'), 'utf8'));
    expect(policyMain).not.toContain('17505169');
    expect(policyMain).not.toContain('122 New Road');
  }
  const privacy = readFileSync(join(pagesDir, 'privacy/index.html'), 'utf8');
  const privacyMain = mainHtml(privacy);
  expect(privacyMain).toContain('href="/company/">EUGNEL LTD</a>');
  expect(privacyMain).toContain('Information Commission (ICO), registration number ZC277339');
  expect(privacyMain).toContain('https://ico.org.uk/make-a-complaint/');
  expect(privacyMain).toMatch(/section 164A of the Data Protection Act 2018/);
  expect(privacyMain).not.toMatch(/application.*pending/i);
  expect(privacyMain).not.toContain('C2062045');

  const refundsMain = mainHtml(readFileSync(join(pagesDir, 'refunds/index.html'), 'utf8'));
  expect(refundsMain).toMatch(/free/i);

  const company = readFileSync(join(companyDir, 'index.html'), 'utf8');
  expect(company).toContain('Company information');
  expect(company).toContain('EUGNEL LTD, registered in England &amp; Wales, company no. 17505169');
  expect(company).toContain('122 New Road, Ascot, SL5 8QH');
  expect(company).toContain('hello@eugnel.com');
  expect(company).toContain('ZC277339');
});

it('escapes hostile company/product strings instead of making executable policy markup', () => {
  const { pagesDir, args } = fixture({ name: '<img src=x onerror=alert(1)>' });
  execFileSync(process.execPath, args);
  for (const page of ['privacy', 'terms', 'refunds', 'data-use']) {
    const html = readFileSync(join(pagesDir, page, 'index.html'), 'utf8');
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
  const { pagesDir, args } = fixture();
  execFileSync(process.execPath, args);
  const first = readFileSync(join(pagesDir, 'privacy/index.html'), 'utf8');
  execFileSync(process.execPath, args);
  expect(readFileSync(join(pagesDir, 'privacy/index.html'), 'utf8')).toBe(first);
});
