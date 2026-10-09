import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { WorkerEnv } from './env';
import { truthy } from './env';
import { errorJson } from './http';

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(teamDomain: string) {
  let set = jwksByIssuer.get(teamDomain);
  if (!set) {
    set = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksByIssuer.set(teamDomain, set);
  }
  return set;
}

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export async function requireAccess(request: Request, env: WorkerEnv): Promise<Response | null> {
  if (truthy(env.SKIP_ACCESS_CHECK)) return null;

  const teamDomain = (env.ACCESS_TEAM_DOMAIN || 'https://eugnel.cloudflareaccess.com').replace(/\/$/, '');
  const aud = env.ACCESS_AUD?.trim();
  if (!aud) {
    return errorJson('ACCESS_AUD not configured', 500);
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    return errorJson('Missing Cf-Access-Jwt-Assertion', 403);
  }

  try {
    await jwtVerify(token, jwksFor(teamDomain), {
      issuer: teamDomain,
      audience: aud,
    });
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid token';
    return errorJson(`Invalid Access token: ${message}`, 403);
  }
}

/** Test helper: drop cached JWKS between cases. */
export function resetAccessJwksCache(): void {
  jwksByIssuer.clear();
}
