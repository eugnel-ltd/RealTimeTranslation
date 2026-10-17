import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index';
import { mockEnv, mockFetch } from './helpers';

const paidRequests = [
  { path: '/api/speech-token', method: 'GET' },
  { path: '/api/translate', method: 'POST' },
  { path: '/api/gemini-token', method: 'GET' },
  { path: '/api/gemini-token', method: 'POST' },
  { path: '/api/gemini-live', method: 'GET' },
  { path: '/api/detect-question', method: 'POST' },
  { path: '/api/answer', method: 'POST' },
];

function apiRequest(path = '/api/health', method = 'GET', headers: HeadersInit = {}): Request {
  return new Request(`https://rtt.eugnel.com${path}`, { method, headers });
}

function limiter(success = true) {
  return { limit: vi.fn().mockResolvedValue({ success }) };
}

const speechEnv = { AZURE_SPEECH_KEY: 'synthetic-test-key' };

describe('API cost guard', () => {
  let providerFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    providerFetch = vi.fn(mockFetch(() => new Response('synthetic-speech-token')));
    vi.stubGlobal('fetch', providerFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses an API request before its handler or the paid limiter runs', async () => {
    const api = limiter(false);
    const paid = limiter();
    const response = await worker.fetch(apiRequest('/api/speech-token'), mockEnv({
      ...speechEnv, API_RATE_LIMIT: api, PAID_API_RATE_LIMIT: paid,
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(await response.json()).toEqual({ error: 'Too many requests' });
    expect(paid.limit).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('applies the API limiter to non-paid routes before their handlers', async () => {
    const env = mockEnv({ API_RATE_LIMIT: limiter(false) });
    const list = vi.spyOn(env.PROFILES!, 'list');
    const response = await worker.fetch(apiRequest('/api/profiles'), env);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(list).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it.each(paidRequests)('refuses $method $path through the shared paid limiter before routing', async ({ path, method }) => {
    const api = limiter();
    const paid = limiter(false);
    const response = await worker.fetch(apiRequest(path, method), mockEnv({
      ...speechEnv, API_RATE_LIMIT: api, PAID_API_RATE_LIMIT: paid,
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(await response.json()).toEqual({ error: 'Too many requests' });
    expect(api.limit).toHaveBeenCalledOnce();
    expect(paid.limit).toHaveBeenCalledOnce();
    expect(api.limit.mock.invocationCallOrder[0]).toBeLessThan(paid.limit.mock.invocationCallOrder[0]);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it.each<{ headers: HeadersInit; key: string }>([
    { headers: { 'Cf-Access-Authenticated-User-Email': 'caller@example.test', 'CF-Connecting-IP': '192.0.2.1' }, key: 'caller@example.test' },
    { headers: { 'CF-Connecting-IP': '192.0.2.1' }, key: '192.0.2.1' },
    { headers: {}, key: 'unknown' },
  ])('uses the same caller key in both budgets: $key', async ({ headers, key }) => {
    const api = limiter();
    const paid = limiter();
    const response = await worker.fetch(apiRequest('/api/speech-token', 'GET', headers), mockEnv({
      ...speechEnv, API_RATE_LIMIT: api, PAID_API_RATE_LIMIT: paid,
    }));

    expect(response.status).toBe(200);
    expect(api.limit).toHaveBeenCalledOnce();
    expect(api.limit).toHaveBeenCalledWith({ key });
    expect(paid.limit).toHaveBeenCalledOnce();
    expect(paid.limit).toHaveBeenCalledWith({ key });
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it.each(['both', 'API_RATE_LIMIT', 'PAID_API_RATE_LIMIT'])('allows paid requests with missing bindings: %s', async (missing) => {
    const env = mockEnv({
      ...speechEnv,
      ...(missing === 'PAID_API_RATE_LIMIT' ? { API_RATE_LIMIT: limiter() } : {}),
      ...(missing === 'API_RATE_LIMIT' ? { PAID_API_RATE_LIMIT: limiter() } : {}),
    });
    const response = await worker.fetch(apiRequest('/api/speech-token'), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ token: 'synthetic-speech-token' });
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it.each(['API_RATE_LIMIT', 'PAID_API_RATE_LIMIT'] as const)('fails closed on a paid route when %s throws', async (binding) => {
    const api = limiter();
    const paid = limiter();
    const broken = binding === 'API_RATE_LIMIT' ? api : paid;
    broken.limit.mockRejectedValue(new Error('Limiter unavailable'));
    const response = await worker.fetch(apiRequest('/api/speech-token'), mockEnv({
      ...speechEnv, API_RATE_LIMIT: api, PAID_API_RATE_LIMIT: paid,
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Rate limiter unavailable' });
    expect(providerFetch).not.toHaveBeenCalled();
    if (binding === 'API_RATE_LIMIT') expect(paid.limit).not.toHaveBeenCalled();
  });

  it('allows non-paid routes when the API limiter throws and skips the paid budget', async () => {
    const api = limiter();
    api.limit.mockRejectedValue(new Error('Limiter unavailable'));
    const paid = limiter(false);
    const response = await worker.fetch(apiRequest(), mockEnv({ API_RATE_LIMIT: api, PAID_API_RATE_LIMIT: paid }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(paid.limit).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('keeps the paid budget available for paid routes when serving health', async () => {
    const api = limiter();
    const paid = limiter(false);
    const response = await worker.fetch(apiRequest(), mockEnv({ API_RATE_LIMIT: api, PAID_API_RATE_LIMIT: paid }));

    expect(response.status).toBe(200);
    expect(api.limit).toHaveBeenCalledOnce();
    expect(paid.limit).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests before counting them', async () => {
    const api = limiter();
    const paid = limiter();
    const response = await worker.fetch(apiRequest('/api/speech-token'), mockEnv({
      ...speechEnv, SKIP_ACCESS_CHECK: 'false', API_RATE_LIMIT: api, PAID_API_RATE_LIMIT: paid,
    }));

    expect(response.status).toBe(403);
    expect(api.limit).not.toHaveBeenCalled();
    expect(paid.limit).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('does not count static asset requests', async () => {
    const api = limiter(false);
    const paid = limiter(false);
    const response = await worker.fetch(apiRequest('/index.html'), mockEnv({ API_RATE_LIMIT: api, PAID_API_RATE_LIMIT: paid }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('asset');
    expect(api.limit).not.toHaveBeenCalled();
    expect(paid.limit).not.toHaveBeenCalled();
  });
});
