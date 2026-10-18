import { isCanonicalAccountId, isObject } from './browserStorage';

export type AccountCapabilities = Readonly<{ email: boolean; google: boolean; apple: boolean; siteKey: string | null }>;
export type AccountSession = Readonly<{ accountId: string; authenticatedAt: string; expiresAt: string }>;
export type EnabledAccount = Readonly<{
  enabled: true;
  scope: Readonly<{ productId: 'rtt'; environment: string; origin: string }>;
  session: AccountSession | null;
  ways: ReadonlyArray<{ provider: 'email' | 'google' | 'apple'; email: string | null }>;
  capabilities: AccountCapabilities;
}>;
export type AccountResponse = { enabled: false } | EnabledAccount;
export type DeletionReceipt = Readonly<{ jobId: string; state: 'pending' | 'completed'; phase: string; completedAt: string | null }>;

export class AccountError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validDate = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
function invalid(): never { throw new AccountError('SERVICE_UNAVAILABLE', 503); }

/** Treat even the bootstrap response as untrusted until the entire scope is valid. */
export function parseAccount(value: unknown, origin: string): AccountResponse {
  if (!isObject(value)) return invalid();
  if (value.enabled === false) return { enabled: false };
  if (value.enabled !== true || !isObject(value.scope) || value.scope.productId !== 'rtt' ||
      value.scope.origin !== origin || !validId(value.scope.environment) ||
      !isObject(value.capabilities) || !Array.isArray(value.ways) || value.ways.length > 5) return invalid();
  const caps = value.capabilities;
  if (typeof caps.email !== 'boolean' || typeof caps.google !== 'boolean' || typeof caps.apple !== 'boolean' ||
      !(caps.siteKey === null || (typeof caps.siteKey === 'string' && caps.siteKey.length > 0 && caps.siteKey.length <= 256)) ||
      (caps.email && !caps.siteKey)) return invalid();
  let session: AccountSession | null = null;
  if (value.session !== null) {
    const raw = value.session;
    if (!isObject(raw) || !isCanonicalAccountId(raw.accountId) || !validDate(raw.authenticatedAt) || !validDate(raw.expiresAt) ||
        Date.parse(raw.expiresAt) <= Date.now() ||
        Date.parse(raw.authenticatedAt) >= Date.parse(raw.expiresAt)) return invalid();
    session = { accountId: raw.accountId, authenticatedAt: raw.authenticatedAt, expiresAt: raw.expiresAt };
  }
  const ways: EnabledAccount['ways'][number][] = [];
  for (const method of value.ways) {
    if (!isObject(method) || !['email', 'google', 'apple'].includes(String(method.provider)) ||
        !(method.email === null || (typeof method.email === 'string' && method.email.length <= 254 && /[•*]/.test(method.email)))) return invalid();
    ways.push({ provider: method.provider as 'email' | 'google' | 'apple', email: method.email as string | null });
  }
  return {
    enabled: true, scope: { productId: 'rtt', environment: value.scope.environment, origin }, session, ways,
    capabilities: { email: caps.email, google: caps.google, apple: caps.apple, siteKey: caps.siteKey as string | null },
  };
}

export function parseDeletion(value: unknown): DeletionReceipt {
  if (!isObject(value) || !validId(value.jobId) || !['pending', 'completed'].includes(String(value.state)) ||
      typeof value.phase !== 'string' || value.phase.length < 1 || value.phase.length > 128 ||
      !(value.completedAt === null || validDate(value.completedAt)) ||
      (value.state === 'completed' && !validDate(value.completedAt))) return invalid();
  return { jobId: value.jobId, state: value.state as 'pending' | 'completed', phase: value.phase, completedAt: value.completedAt as string | null };
}

/** Auth mutations intentionally do not use an account's revoked request lifetime. */
export async function accountRequest(path: string, body?: Record<string, unknown>, signal?: AbortSignal, expectedAccount?: string): Promise<unknown> {
  const deadline = AbortSignal.timeout(15_000);
  const headers = new Headers(body ? { 'Content-Type': 'application/json' } : undefined);
  if (expectedAccount) headers.set('Eugnel-Expected-Account', expectedAccount);
  const response = await fetch(path, {
    credentials: 'include', cache: 'no-store', signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    headers,
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  let data: unknown;
  try { data = await response.json(); } catch { return invalid(); }
  if (!response.ok) {
    const code = isObject(data) && typeof data.error === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(data.error) ? data.error : 'SERVICE_UNAVAILABLE';
    throw new AccountError(code, response.status);
  }
  return data;
}

export function accountMessage(error: unknown): string {
  if (error instanceof AccountError) {
    if (error.code === 'REAUTH_REQUIRED') return 'Verify an existing sign-in method again, then retry account deletion.';
    if (error.status === 429) return 'Too many attempts. Please wait before trying again.';
    if (error.code.includes('TURNSTILE')) return 'Complete the verification challenge again.';
    if (error.status === 400 || error.status === 401 || error.status === 403) return 'Verification did not complete. Check the code or try an existing sign-in method again.';
  }
  return 'Accounts are temporarily unavailable. Please retry.';
}
