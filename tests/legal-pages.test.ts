import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

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

function mainHtml(html: string) {
  return html.match(/<main>([\s\S]*)<\/main>/)?.[1] ?? '';
}

it('generates legal pages with a minimal site footer linking to Company information', () => {
  const { pagesDir, args } = fixture();
  execFileSync(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const page of ['privacy', 'terms', 'refunds', 'data-use']) {
    const html = readFileSync(join(pagesDir, page, 'index.html'), 'utf8');
    expect(html).toMatch(/<!doctype html>/i);
    const footer = html.match(/<footer[^>]*>([\s\S]*?)<\/footer>/)?.[1] ?? '';
    expect(footer, `${page}: missing minimal footer`).toContain('© EUGNEL LTD');
    expect(footer, `${page}: minimal footer must link to Company information`).toContain('href="/company/">Company information</a>');
    expect(footer).not.toMatch(/17505169|122 New Road|hello@eugnel.com|ZC277339/);
    expect(footer.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/legal/privacy/"');
    expect(html).toContain('hello@eugnel.com');
  }
});

it('keeps policy bodies free of the address and company number while preserving controller and acceptance statements', () => {
  const { pagesDir, args } = fixture();
  execFileSync(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const page of ['privacy', 'terms', 'refunds'] as const) {
    const policyMain = mainHtml(readFileSync(join(pagesDir, page, 'index.html'), 'utf8'));
    expect(policyMain, `${page}: policy body must have no company number`).not.toContain('17505169');
    expect(policyMain, `${page}: policy body must have no address`).not.toContain('122 New Road');
  }
  const privacy = readFileSync(join(pagesDir, 'privacy/index.html'), 'utf8');
  const privacyMain = mainHtml(privacy);
  expect(privacyMain).toContain('href="/company/">EUGNEL LTD</a>');
  expect(privacyMain).toContain('(&quot;we&quot;) makes Real-Time Translation. We are the controller of the personal data this policy describes.');
  const termsMain = mainHtml(readFileSync(join(pagesDir, 'terms/index.html'), 'utf8'));
  expect(termsMain).toContain('These terms are a contract between you and');
  expect(termsMain).toContain('EUGNEL LTD</a> (&quot;we&quot;). By using Real-Time Translation you accept them.');
  expect(privacyMain).toContain('Information Commission (ICO), registration number ZC277339');
  expect(privacyMain).toContain('https://ico.org.uk/make-a-complaint/');
  expect(privacyMain).toMatch(/section 164A of the Data Protection Act 2018/);
  expect(privacyMain).not.toMatch(/application.*pending/i);
  expect(privacyMain).not.toContain('C2062045');

  const refundsMain = mainHtml(readFileSync(join(pagesDir, 'refunds/index.html'), 'utf8'));
  expect(refundsMain).toMatch(/free/i);
});

it('generates a Company information page with full company details and working policy destinations', () => {
  const { companyDir, args } = fixture();
  execFileSync(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const companyPath = join(companyDir, 'index.html');
  expect(existsSync(companyPath), 'Missing Company information page').toBe(true);
  const company = readFileSync(companyPath, 'utf8');
  for (const href of ['/legal/privacy/', '/legal/terms/', '/legal/refunds/', '/legal/data-use/']) {
    expect(company, `Missing policy destination ${href} from Company information page`).toContain(`href="${href}"`);
  }
  expect(company).toContain('Company information');
  expect(company).toContain('EUGNEL LTD, registered in England &amp; Wales, company no. 17505169');
  expect(company).toContain('122 New Road, Ascot, SL5 8QH');
  expect(company).toContain('hello@eugnel.com');
  expect(company).toContain('ZC277339');
});

it('escapes hostile company/product strings instead of making executable policy markup', () => {
  const { pagesDir, args } = fixture({ name: '<img src=x onerror=alert(1)>' });
  execFileSync(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const page of ['privacy', 'terms', 'refunds', 'data-use']) {
    const html = readFileSync(join(pagesDir, page, 'index.html'), 'utf8');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
  }
});

it('fails before writing policy files when required data facts are absent', () => {
  const { directory, args } = fixture({ legal: { audience: 'general', processors: [] } });
  // A regular file also captures Node diagnostics in runners that restrict
  // socket-backed child-process pipes. The generator does not read stdin.
  const diagnosticPath = join(directory, 'stderr.txt');
  const diagnostic = openSync(diagnosticPath, 'w');
  let result;
  try {
    result = spawnSync(process.execPath, args, { stdio: ['ignore', 'ignore', diagnostic] });
  } finally {
    closeSync(diagnostic);
  }
  const stderr = readFileSync(diagnosticPath, 'utf8');
  rmSync(diagnosticPath);
  expect(result.status).not.toBe(0);
  expect(stderr).toMatch(/legal\.data|legal\.processors/);
  expect(readdirSync(directory)).toEqual(['company.json', 'manifest.json']);
});

it('produces stable documents from the same reviewed inputs', () => {
  const { pagesDir, args } = fixture();
  execFileSync(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const first = readFileSync(join(pagesDir, 'privacy/index.html'), 'utf8');
  execFileSync(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  expect(readFileSync(join(pagesDir, 'privacy/index.html'), 'utf8')).toBe(first);
});
