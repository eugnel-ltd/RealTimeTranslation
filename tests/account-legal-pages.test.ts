import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

const directory = mkdtempSync(join(tmpdir(), 'rtt-account-notices-'));
const pages: Record<string, string> = {};
beforeAll(() => {
  execFileSync(process.execPath, ['scripts/generate-legal.mjs', '--out', directory]);
  for (const route of ['privacy', 'terms', 'refunds', 'data-use']) {
    pages[route] = readFileSync(join(directory, route, 'index.html'), 'utf8');
  }
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

it('keeps the actual private free service and registered ICO facts while describing conditional accounts', () => {
  expect(pages['data-use']).toMatch(/private tool for the authorised adult owner/);
  expect(pages['data-use']).toContain('Public signup is unavailable');
  expect(pages.refunds).toMatch(/free/i);
  expect(pages.privacy).toContain('ZC277339');
  expect(pages.privacy).toContain('Information Commission (ICO)');
  expect(pages.privacy).toContain('EUGNEL LTD · Registered in England &amp; Wales · Company no. 17505169');
  expect(pages.privacy).not.toMatch(/application.*pending|C2062045|Berkshire/);
  expect(pages['data-use']).toMatch(/Account sign-in when available/);
  expect(pages['data-use']).toMatch(/account features are disabled in the current private service/i);
});

it('renders identity and customer profile purposes without claiming an active customer database', () => {
  expect(pages.privacy).toMatch(/Account identity and sign-in proofs when enabled/);
  expect(pages.privacy).toMatch(/Customer candidate profiles when enabled/);
  expect(pages['data-use']).toMatch(/Google sign-in requests only your identifier and email/i);
  expect(pages['data-use']).toMatch(/Apple can provide your email or a relay address/i);
  expect(pages['data-use']).toMatch(/does not give us access to your mailbox or documents/i);
  expect(pages['data-use']).toMatch(/Existing owner profiles remain separate/i);
  expect(pages['data-use']).not.toContain('this app has no customer-account deletion feature');
});

it('distinguishes necessary credential validity from physical record cleanup', () => {
  const html = pages['data-use'];
  expect(html).toMatch(/session cookie is valid for up to 30 days/i);
  expect(html).toMatch(/sign-in flow cookie and email code are valid for up to 10 minutes/i);
  expect(html).toMatch(/deletion-resumption cookie is valid for up to 30 days/i);
  expect(html).toMatch(/Secure and HttpOnly/);
  expect(html).toMatch(/expiry stops use of a credential; it does not prove that its stored record has been erased/i);
  expect(html).toMatch(/cleanup runs in bounded batches when maintenance is invoked/i);
});

it('describes retryable account erasure and the actual limits of local cache deletion', () => {
  const html = pages['data-use'];
  expect(html).toMatch(/recent sign-in and explicit confirmation/i);
  expect(html).toMatch(/blocks further account use before attempting deletion/i);
  expect(html).toMatch(/pending or retry status is not confirmation of completion/i);
  expect(html).toMatch(/minimal security records remain/i);
  expect(html).toMatch(/permanent random account identifiers and timestamps/i);
  expect(html).toMatch(/only the verified account&#39;s known settings, history and fallback marker in this browser/i);
  expect(html).toMatch(/may need to clear this site&#39;s data manually/i);
  expect(html).toMatch(/does not clear other browsers or devices/i);
  expect(html).not.toMatch(/all (?:your )?data (?:is|will be) (?:immediately|permanently) (?:deleted|erased)/i);
});

it('links distinct official identity, security, mail and backup notices', () => {
  for (const href of [
    'https://policies.google.com/privacy',
    'https://www.apple.com/legal/privacy/data/en/sign-in-with-apple/',
    'https://www.cloudflare.com/turnstile-privacy-policy/',
    'https://developers.cloudflare.com/email-service/observability/logs/',
    'https://developers.cloudflare.com/d1/reference/time-travel/',
  ]) expect(pages['data-use']).toContain(`href="${href}"`);
});

it('discloses provider-controlled retention and Turnstile roles without a zero-retention promise', () => {
  const html = pages['data-use'];
  expect(html).toMatch(/Turnstile processes browser and network signals/i);
  expect(html).toMatch(/separate controller for improving bot detection/i);
  expect(html).toMatch(/sent-message previews can retain the full message for about seven days when enabled/i);
  expect(html).toMatch(/D1 backup recovery windows are published as 30 days on Workers Paid and seven days on Free/i);
  expect(html).toMatch(/actual sender-preview setting, database plan, jurisdiction and any exports need verification/i);
});

it('preserves optional local history and has no advertising or fabricated consent control', () => {
  const html = pages['data-use'];
  expect(html).toMatch(/only after you enable/);
  expect(html).toMatch(/Providers can buffer audio/);
  expect(html).toMatch(/existing saved history and notes stay/);
  expect(html).toMatch(/no advertising or optional client usage tracker/);
  expect(html).not.toMatch(/accept all cookies|advertising consent|<script|<iframe/i);
});
