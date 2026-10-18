import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { mockEnv } from './helpers';

const fetchWorker: (request: Request, configuration: ReturnType<typeof mockEnv>, ctx?: ExecutionContext) => Promise<Response> = worker.fetch;

const DSN = `https://${'1'.repeat(32)}@rtt-test.invalid/12345`;
const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function context() {
  const tasks: Promise<unknown>[] = [];
  const waitUntil = vi.fn((task: Promise<unknown>) => { tasks.push(task); });
  return { tasks, waitUntil, ctx: { waitUntil } as unknown as ExecutionContext };
}
function env(dsn: string | undefined = DSN): ReturnType<typeof mockEnv> & { SENTRY_DSN?: string; DEPLOYMENT_SHA: string } {
  return Object.assign(mockEnv({ AZURE_SPEECH_KEY: 'test-key', GEMINI_API_KEY: 'test-key' }), {
    SENTRY_DSN: dsn, DEPLOYMENT_SHA: 'a'.repeat(40),
  });
}
function request(path = '/api/speech-token', body?: unknown) {
  return new Request(`https://rtt.eugnel.com${path}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) });
}
function isReport(input: unknown) { return String(input).includes('/envelope/'); }

describe('server-only failure reporting', () => {
  it('reports one returned server failure through waitUntil with static metadata', async () => {
    const envelopes: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (isReport(input)) { envelopes.push(String(init?.body)); return new Response(null); }
      return new Response('private provider body', { status: 503 });
    });
    const { tasks, ctx, waitUntil } = context();
    const response = await fetchWorker(request(), env(), ctx);
    expect(response.status).toBe(502);
    await Promise.all(tasks);
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(envelopes).toHaveLength(1);
    const event = JSON.parse(envelopes[0].split('\n')[2]);
    expect(event.release).toBe(`rtt@${version}+${'a'.repeat(40)}`);
    expect(event.tags).toMatchObject({ route: 'speech-token', status: '502' });
    expect(envelopes[0]).not.toContain('private provider body');
  });

  it('never captures original errors, request data or headers', async () => {
    const marker = 'synthetic-private-provider-request-marker';
    const logs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const envelopes: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (isReport(input)) { envelopes.push(String(init?.body)); return new Response(null); }
      const failure = new Error(marker);
      failure.name = marker;
      failure.stack = marker;
      throw failure;
    });
    const req = request(`/api/translate?private=${marker}`, { text: marker, to: ['en'] });
    req.headers.set('Authorization', `Bearer ${marker}`);
    const { tasks, ctx } = context();
    const response = await fetchWorker(req, env(), ctx);
    expect(response.status).toBe(500);
    await Promise.all(tasks);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).not.toContain(marker);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(marker);
    expect(await response.text()).not.toContain(marker);
  });

  it.each([undefined, 'invalid-private-configuration'])('keeps missing or malformed configuration disabled: %s', async (dsn) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));
    const { ctx, tasks } = context();
    const configuration = env();
    configuration.SENTRY_DSN = dsn;
    const response = await fetchWorker(request(), configuration, ctx);
    await Promise.all(tasks);
    expect(response.status).toBe(502);
    expect(fetchSpy.mock.calls.filter(([input]) => isReport(input))).toHaveLength(0);
  });

  it('isolates a failed reporting transport from the original response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (isReport(input)) throw new Error('synthetic-private-reporting-failure');
      return new Response(null, { status: 503 });
    });
    const { tasks, ctx } = context();
    const response = await fetchWorker(request(), env(), ctx);
    expect(response.status).toBe(502);
    expect(tasks).toHaveLength(1);
    await expect(Promise.all(tasks)).resolves.toBeDefined();
  });

  it('settles a hanging reporting transport at two seconds without delaying the response', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (!isReport(input)) return new Response(null, { status: 503 });
      signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('synthetic-private-timeout')), { once: true });
      });
    });
    const { tasks, ctx } = context();
    const response = await fetchWorker(request(), env(), ctx);
    expect(response.status).toBe(502);
    expect(tasks).toHaveLength(1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(tasks);
    expect(signal?.aborted).toBe(true);
  });

  it.each(['invalid request', 'Access denial', 'rate refusal'])('does not capture expected %s', async (mode) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not call providers'));
    const configuration = env();
    if (mode === 'Access denial') configuration.SKIP_ACCESS_CHECK = 'false';
    if (mode === 'rate refusal') configuration.API_RATE_LIMIT = { limit: async () => ({ success: false }) };
    const { tasks, ctx, waitUntil } = context();
    const response = await fetchWorker(request('/api/translate', { text: 12 }), configuration, ctx);
    expect(response.status).toBe(mode === 'Access denial' ? 403 : mode === 'rate refusal' ? 429 : 400);
    await Promise.all(tasks);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(['UNKNOWN', 'RESOURCE_EXHAUSTED'])('handles stream failures without private data or quota noise: %s', async (status) => {
    const marker = 'synthetic-private-stream-error';
    const envelopes: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (isReport(input)) { envelopes.push(String(init?.body)); return new Response(null); }
      return new Response(`data: ${JSON.stringify({ error: { status, message: marker } })}\n\n`);
    });
    const { tasks, ctx } = context();
    const response = await fetchWorker(request('/api/answer', { question: 'Why?', force: true }), env(), ctx);
    const text = await response.text();
    await Promise.all(tasks);
    expect(response.status).toBe(200);
    expect(text).toContain('event: error');
    expect(text).not.toContain(marker);
    expect(envelopes).toHaveLength(status === 'RESOURCE_EXHAUSTED' ? 0 : 1);
    expect(JSON.stringify(envelopes)).not.toContain(marker);
  });
});

describe('shared health behind Access', () => {
  it('preserves the old health response and adds shared health without paid calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('health must not call a provider'));
    expect(await (await fetchWorker(request('/api/health'), env())).json()).toEqual({ ok: true });
    const response = await fetchWorker(request('/api/healthz'), env());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', product: 'rtt', version });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses unconfigured providers and keeps Access and rate budgets in front', async () => {
    const unhealthy = await fetchWorker(request('/api/healthz'), mockEnv());
    expect(unhealthy.status).toBe(503);
    const denied = await fetchWorker(request('/api/healthz'), mockEnv({ SKIP_ACCESS_CHECK: 'false' }));
    expect(denied.status).toBe(403);
    const limited = await fetchWorker(request('/api/healthz'), mockEnv({ API_RATE_LIMIT: { limit: async () => ({ success: false }) } }));
    expect(limited.status).toBe(429);
  });
});
