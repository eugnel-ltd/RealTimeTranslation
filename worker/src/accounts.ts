import { AccountRequestError, accountFailure, validAccountId } from './accountErrors';
import { createAccountProfiles, type AccountProfiles } from './accountProfiles';
import type { WorkerEnv } from './env';
import { errorJson, isJsonObject, json } from './http';

export const ACCOUNT_ERASER_PATH = '/_internal/identity/erase';
type Scope = Readonly<{ productId: 'rtt'; environment: 'production' | 'preview'; origin: string }>;
export type VerifiedAccount = Readonly<{ accountId: string; authenticatedAt: string; expiresAt: string }>;
export type AccountContext = Readonly<{ mode: 'legacy' }> | Readonly<{ mode: 'customer'; scope: Scope; session: VerifiedAccount; profiles: AccountProfiles }>;
const legacy: AccountContext = Object.freeze({ mode: 'legacy' });

function validCredential(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 32 && value.length <= 1024;
}
function validCaller(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

export function accountConfiguration(env: WorkerEnv) {
  if (env.ACCOUNTS_ENABLED !== '1') return null;
  try {
    const { ACCOUNT_DB: db, ACCOUNT_ENVIRONMENT: environment, ACCOUNT_ORIGIN: origin } = env;
    if (typeof db?.prepare !== 'function' || typeof db.batch !== 'function'
        || !['production', 'preview'].includes(environment ?? '') || typeof origin !== 'string' || origin.length > 2048) throw new AccountRequestError(503);
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) throw new AccountRequestError(503);
    const scope: Scope = Object.freeze({ productId: 'rtt', environment: environment as 'production' | 'preview', origin });
    return Object.freeze({ db, scope });
  } catch (error) { return accountFailure(error); }
}

function sameScope(value: unknown, scope: Scope): boolean {
  return isJsonObject(value) && value.productId === scope.productId && value.environment === scope.environment && value.origin === scope.origin;
}

function sessionToken(request: Request): string {
  const header = request.headers.get('Cookie') ?? '';
  if (header.length > 4096) throw new AccountRequestError(400, 'Invalid session cookie');
  const found = header.split(';').map(part => part.trim()).filter(part => part.split('=', 1)[0].trim() === '__Host-eugnel_session');
  if (found.length > 1) throw new AccountRequestError(400, 'Invalid session cookie');
  if (found.length === 0) throw new AccountRequestError(401, 'Sign in required');
  if (!found[0].startsWith('__Host-eugnel_session=')) throw new AccountRequestError(400, 'Invalid session cookie');
  const token = found[0].slice('__Host-eugnel_session='.length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AccountRequestError(400, 'Invalid session cookie');
  return token;
}

function sessionValue(value: unknown): VerifiedAccount {
  if (value === null) throw new AccountRequestError(401, 'Sign in required');
  if (!isJsonObject(value) || !validAccountId(value.accountId) || typeof value.authenticatedAt !== 'string' || typeof value.expiresAt !== 'string') throw new AccountRequestError(503);
  const authenticated = Date.parse(value.authenticatedAt);
  const expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(authenticated) || !Number.isFinite(expires) || authenticated > Date.now() + 60_000
      || expires <= authenticated || expires - authenticated > 30 * 24 * 60 * 60 * 1000) throw new AccountRequestError(503);
  if (expires <= Date.now()) throw new AccountRequestError(401, 'Sign in required');
  return Object.freeze({ accountId: value.accountId, authenticatedAt: value.authenticatedAt, expiresAt: value.expiresAt });
}

export async function resolveAccountContext(request: Request, env: WorkerEnv): Promise<AccountContext> {
  const configuration = accountConfiguration(env);
  if (!configuration) return legacy;
  // Capture every authority input before awaiting the shared service.
  const { db, scope } = configuration;
  const { IDENTITY_SERVICE: binding, IDENTITY_CALLER_ID: callerId, IDENTITY_CALLER_SECRET: secret } = env;
  if (typeof binding?.fetch !== 'function' || !validCaller(callerId) || !validCredential(secret)) throw new AccountRequestError(503);
  if (new URL(request.url).origin !== scope.origin) throw new AccountRequestError(403, 'Invalid account origin');
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('Origin') !== scope.origin) throw new AccountRequestError(403, 'Invalid account origin');
  const token = sessionToken(request);
  try {
    const { createIdentityClient } = await import('eugnel-platform/auth/identity');
    const client = createIdentityClient({ binding, callerId, secret });
    const response = await client.request('/v1/session', { token });
    if (response.status !== 200) throw new AccountRequestError(503);
    const payload: unknown = await response.json();
    if (!isJsonObject(payload) || !sameScope(payload.scope, scope)) throw new AccountRequestError(503);
    const session = sessionValue(payload.session);
    const profiles = createAccountProfiles(db, session.accountId);
    await profiles.assertActive();
    return Object.freeze({ mode: 'customer', scope, session, profiles });
  } catch (error) { return accountFailure(error); }
}

export async function handleAccountErasure(request: Request, env: WorkerEnv): Promise<Response> {
  const configuration = accountConfiguration(env);
  if (!configuration) return errorJson('Not found', 404);
  if (request.method !== 'POST') throw new AccountRequestError(403, 'Erasure authentication required');
  const { db, scope } = configuration;
  const { IDENTITY_ERASER_CALLER: callerId, IDENTITY_ERASER_SECRET: secret } = env;
  if (!validCaller(callerId) || !validCredential(secret) || callerId === env.IDENTITY_CALLER_ID || secret === env.IDENTITY_CALLER_SECRET) throw new AccountRequestError(503);
  try {
    const { createServiceAuthenticator } = await import('eugnel-platform/auth/identity');
    const authenticator = createServiceAuthenticator({ enabled: '1', db, registry: [{ callerId, secret, role: 'eraser', actions: ['erase'], scope }] });
    const authenticated = await authenticator.authenticate(request);
    if (!authenticated || authenticated.principal.callerId !== callerId || authenticated.principal.role !== 'eraser' || !sameScope(authenticated.principal.scope, scope)) throw new AccountRequestError(403, 'Erasure authentication required');
    const payload = authenticated.payload;
    if (!isJsonObject(payload) || Object.keys(payload).length !== 2 || !validAccountId(payload.accountId) || !validAccountId(payload.jobId)) throw new AccountRequestError(400, 'Invalid erasure request');
    await createAccountProfiles(db, payload.accountId).erase(payload.jobId);
    return json({ ok: true, jobId: payload.jobId }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    if (error instanceof AccountRequestError) throw error;
    const code = isJsonObject(error) ? error.code : undefined;
    if (code === 'CALLER_INVALID') throw new AccountRequestError(403, 'Erasure authentication required');
    if (code === 'REQUEST_INVALID') throw new AccountRequestError(400, 'Invalid erasure request');
    return accountFailure(error);
  }
}
