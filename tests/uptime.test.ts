import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const checkUptime: typeof import('../scripts/uptime.mjs').checkUptime = async (...args) =>
  (await import('../scripts/uptime.mjs')).checkUptime(...args);

const credentials = { clientId: 'test-access-id', clientSecret: 'test-access-secret' };
const sensitive = 'private-provider-response-marker';
const health = (body: unknown = { status: 'ok', version: '1.0.0' }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const serve = (api: () => Response = () => health(), homepageStatus = 200) =>
  vi.fn<typeof fetch>(async (url) => String(url).endsWith('/api/healthz') ? api() : new Response('<html>RTT</html>', { status: homepageStatus }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Access-compatible RTT uptime checks', () => {
  it('exits 2 with structured unconfigured output when the CLI has no monitor credentials', () => {
    const processResult = spawnSync(process.execPath, ['scripts/uptime.mjs'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { PATH: process.env.PATH, RTT_UPTIME_ACCESS_CLIENT_ID: '', RTT_UPTIME_ACCESS_CLIENT_SECRET: '' },
      encoding: 'utf8',
    });
    expect(processResult.status).toBe(2);
    expect(JSON.parse(processResult.stdout)).toMatchObject({ configured: false, healthy: false, exitCode: 2 });
    expect(processResult.stderr).toBe('');
  });

  it('checks only the fixed RTT homepage and shared health endpoint with Access headers and manual redirects', async () => {
    const fetchImpl = serve();
    const result = await checkUptime({ ...credentials, fetchImpl });

    expect(result).toMatchObject({ configured: true, healthy: true, exitCode: 0 });
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      'https://rtt.eugnel.com/', 'https://rtt.eugnel.com/api/healthz',
    ]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init?.redirect).toBe('manual');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const headers = new Headers(init?.headers);
      expect(headers.get('CF-Access-Client-Id')).toBe(credentials.clientId);
      expect(headers.get('CF-Access-Client-Secret')).toBe(credentials.clientSecret);
    }
    expect(JSON.stringify(result)).not.toContain(credentials.clientSecret);
  });

  it.each([
    { clientId: '', clientSecret: credentials.clientSecret },
    { clientId: credentials.clientId, clientSecret: '' },
    { clientId: ' ', clientSecret: credentials.clientSecret },
    { clientId: credentials.clientId, clientSecret: '\t' },
  ])('does not make requests or declare an outage when Access credentials are absent: %j', async (options) => {
    const fetchImpl = serve();
    expect(await checkUptime({ ...options, fetchImpl })).toEqual({
      configured: false, healthy: false, exitCode: 2, reason: 'missing_credentials', checks: {},
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads only the dedicated monitor environment credentials by default', async () => {
    vi.stubEnv('RTT_UPTIME_ACCESS_CLIENT_ID', credentials.clientId);
    vi.stubEnv('RTT_UPTIME_ACCESS_CLIENT_SECRET', credentials.clientSecret);
    const fetchImpl = serve();
    expect((await checkUptime({ fetchImpl })).healthy).toBe(true);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(new Headers(init?.headers).get('CF-Access-Client-Secret')).toBe(credentials.clientSecret);
    }
  });

  it.each([302, 403, 503])('fails homepage HTTP %i without following an off-origin redirect', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => String(url).endsWith('/api/healthz')
      ? health()
      : new Response(null, { status, headers: { Location: 'https://off-origin.invalid/login' } }));
    const result = await checkUptime({ ...credentials, fetchImpl });
    expect(result).toMatchObject({ configured: true, healthy: false, exitCode: 1, checks: { homepage: { healthy: false, status } } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([url, init]) => new URL(String(url)).origin === 'https://rtt.eugnel.com' && init?.redirect === 'manual')).toBe(true);
  });

  it.each([302, 403, 503])('fails API HTTP %i even if its JSON claims status ok', async (status) => {
    const result = await checkUptime({ ...credentials, fetchImpl: serve(() => health({ status: 'ok', private: sensitive }, status)) });
    expect(result).toMatchObject({ configured: true, healthy: false, exitCode: 1, checks: { api: { healthy: false, status } } });
    expect(JSON.stringify(result)).not.toContain(sensitive);
  });

  it.each([{ status: 'fail', checks: { provider: sensitive } }, { ok: true }, null, []])('requires the shared status ok health shape: %j', async (body) => {
    const result = await checkUptime({ ...credentials, fetchImpl: serve(() => health(body)) });
    expect(result).toMatchObject({ configured: true, healthy: false, exitCode: 1, checks: { api: { healthy: false } } });
    expect(JSON.stringify(result)).not.toContain(sensitive);
  });

  it.each(['<html>Access login</html>', '{invalid'])('rejects a successful API response whose body is not JSON: %s', async (body) => {
    const result = await checkUptime({ ...credentials, fetchImpl: serve(() => new Response(body)) });
    expect(result).toMatchObject({ healthy: false, exitCode: 1, checks: { api: { healthy: false } } });
    expect(JSON.stringify(result)).not.toContain(body);
  });

  it('can check a declared version without printing untrusted version strings', async () => {
    const result = await checkUptime({ ...credentials, fetchImpl: serve(() => health({ status: 'ok', version: sensitive })), expectVersion: '1.0.0' });
    expect(result).toMatchObject({ healthy: false, exitCode: 1 });
    expect(JSON.stringify(result)).not.toContain(sensitive);
  });

  it('does not return raw network error messages or credential values', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error(`${sensitive} ${credentials.clientSecret}`); });
    const result = await checkUptime({ ...credentials, fetchImpl });
    expect(result).toMatchObject({ configured: true, healthy: false, exitCode: 1 });
    expect(JSON.stringify(result)).not.toContain(sensitive);
    expect(JSON.stringify(result)).not.toContain(credentials.clientSecret);
  });

  it('bounds requests even when the injected fetch ignores cancellation', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const pending = checkUptime({ ...credentials, fetchImpl, timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(25);
    const result = await pending;
    expect(result).toMatchObject({ healthy: false, exitCode: 1, checks: { homepage: { reason: 'timeout' }, api: { reason: 'timeout' } } });
    expect(fetchImpl.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
  });

  it('bounds reading a health response body that never finishes', async () => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream({ start() { /* Deliberately never ends. */ } }));
    const pending = checkUptime({ ...credentials, fetchImpl: serve(() => response), timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toMatchObject({ healthy: false, exitCode: 1, checks: { api: { reason: 'timeout' } } });
  });

  it('caps an excessive configured timeout at twenty seconds', async () => {
    vi.useFakeTimers();
    const pending = checkUptime({ ...credentials, fetchImpl: vi.fn<typeof fetch>(() => new Promise(() => {})), timeoutMs: 1_000_000 });
    await vi.advanceTimersByTimeAsync(20_001);
    expect(await pending).toMatchObject({ healthy: false, exitCode: 1 });
  });
});
