import type { WorkerEnv } from './env';
import { accountConfiguration } from './accounts';
import { isJsonObject, json } from './http';

const paths = new Set(['/api/account','/api/account/delete','/api/account/delete/status','/api/account/delete/advance',
  '/api/auth/capabilities','/api/auth/email/start','/api/auth/email/verify','/api/auth/signout','/api/auth/google/cancel',
  '/api/auth/google/start','/api/auth/google/callback','/api/auth/apple/start','/api/auth/apple/callback','/api/auth/apple/finalize','/api/auth/apple/notifications']);
const names = new Set(['__Host-eugnel_session','__Host-eugnel_flow','__Host-eugnel_delete']);
class ProxyFailure extends Error { constructor(readonly status = 503) { super('Account service unavailable'); } }
const failure = (status: number) => json({ error: status === 400 ? 'REQUEST_INVALID' : 'SERVICE_UNAVAILABLE' }, status, { 'Cache-Control': 'no-store' });

export const isAccountAuthPath = (path: string) => paths.has(path);
function identityCookies(request: Request): string | undefined {
  const header = request.headers.get('Cookie') ?? '';
  if (header.length > 16384) throw new ProxyFailure(400);
  const selected = new Map<string,string>();
  for (const part of header.split(';')) {
    const at = part.indexOf('='); const name = part.slice(0, at).trim();
    if (!names.has(name)) continue;
    const value = part.slice(at + 1).trim();
    if (selected.has(name) || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new ProxyFailure(400);
    selected.set(name, `${name}=${value}`);
  }
  return selected.size ? [...selected.values()].join('; ') : undefined;
}
async function requestBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let length = 0;
  const chunks: Uint8Array[] = [];
  const consume = async () => {
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > 4096) { void reader.cancel().catch(() => {}); throw new ProxyFailure(400); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    } finally { reader.releaseLock(); }
  };
  try {
    return await Promise.race([consume(), new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new ProxyFailure(400)); }, 5000); })]);
  } catch { throw new ProxyFailure(400); }
  finally { clearTimeout(timer); }
}
function safeRedirect(value: string, origin: string): boolean {
  if (value.length > 8192 || /[\\\r\n]/.test(value) || value.startsWith('//')) return false;
  const url = new URL(value, origin);
  return url.origin === origin || url.protocol === 'https:' && (
    url.origin === 'https://accounts.google.com' && url.pathname === '/o/oauth2/v2/auth'
    || url.origin === 'https://appleid.apple.com' && url.pathname === '/auth/authorize');
}
function responseCookies(response: Response): string[] {
  const cookies = response.headers.getSetCookie();
  for (const cookie of cookies) {
    const parts = cookie.split(';').map(value => value.trim());
    const [pair, ...attributes] = parts; const at = pair.indexOf('=');
    const name = pair.slice(0, at), value = pair.slice(at + 1);
    const lower = attributes.map(value => value.toLowerCase());
    if (!names.has(name) || !(value === '' || /^[A-Za-z0-9_-]{43}$/.test(value))
      || !lower.includes('httponly') || !lower.includes('secure') || !lower.includes('path=/')
      || lower.some(value => value.startsWith('domain='))
      || !lower.includes(name === '__Host-eugnel_flow' ? 'samesite=none' : 'samesite=lax')) throw new ProxyFailure();
  }
  return cookies;
}

// Call only after the existing Access and API rate checks. The signed service
// envelope captures the configured origin; browser IDs/Access credentials are
// never forwarded as identity authority.
export async function handleAccountAuth(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  if (env.ACCOUNTS_ENABLED !== '1') return url.pathname === '/api/account' && request.method === 'GET'
    ? json({ enabled: false }, 200, { 'Cache-Control': 'no-store' }) : json({ error: 'AUTH_DISABLED' }, 404, { 'Cache-Control': 'no-store' });
  try {
    const config = accountConfiguration(env);
    if (!config || url.origin !== config.scope.origin) throw new ProxyFailure(400);
    const binding = env.IDENTITY_SERVICE, callerId = env.IDENTITY_CALLER_ID, secret = env.IDENTITY_CALLER_SECRET;
    if (!binding || typeof callerId !== 'string' || typeof secret !== 'string') throw new ProxyFailure();
    if (!['GET','POST'].includes(request.method)) throw new ProxyFailure(400);
    if (request.method === 'POST' && !['/api/auth/apple/callback','/api/auth/apple/notifications'].includes(url.pathname)
      && request.headers.get('Origin') !== config.scope.origin) throw new ProxyFailure(400);
    const headers: Record<string,string> = {};
    const cookies = identityCookies(request); if (cookies) headers.Cookie = cookies;
    for (const name of ['Origin','Content-Type','CF-Connecting-IP']) { const value = request.headers.get(name); if (value !== null) headers[name] = value; }
    const payload = { method: request.method, path: `${url.pathname}${url.search}`, headers,
      ...(request.method === 'POST' ? { body: await requestBody(request) } : {}) };
    const { createIdentityClient } = await import('eugnel-platform/auth/identity');
    const response = await createIdentityClient({ binding, callerId, secret }).request('/v1/browser', payload);
    const location = response.headers.get('Location');
    if (location && (!['302','303'].includes(String(response.status)) || !safeRedirect(location, config.scope.origin))) throw new ProxyFailure();
    const setCookies = responseCookies(response);
    if (url.pathname === '/api/account' && response.status === 200) {
      const result: unknown = await response.clone().json();
      if (!isJsonObject(result) || result.enabled !== true || !isJsonObject(result.scope)
        || result.scope.productId !== config.scope.productId || result.scope.environment !== config.scope.environment || result.scope.origin !== config.scope.origin) throw new ProxyFailure();
    }
    const outgoing = new Headers({ 'Cache-Control': 'no-store' });
    const contentType = response.headers.get('Content-Type'); if (contentType) outgoing.set('Content-Type', contentType);
    if (location) outgoing.set('Location', location);
    for (const value of setCookies) outgoing.append('Set-Cookie', value);
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch (error) { return failure(error instanceof ProxyFailure ? error.status : 503); }
}
