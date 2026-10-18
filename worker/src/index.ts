import { requireAccess, isApiPath } from './access';
import { handleAnswer } from './answer';
import { SESSION_TEMPLATES } from '../../shared/sessionTemplates';
import { handleDetectQuestion } from './detect-question';
import type { WorkerEnv } from './env';
import { handleGeminiLiveProxy, handleGeminiToken } from './gemini';
import { errorJson, InvalidRequestError, json, log, logError } from './http';
import { handleGetProfile, handleListProfiles, handlePutProfile } from './profiles';
import { handleSpeechToken } from './speech-token';
import { handleTranslate } from './translate';
import { handleHealth, reportServerFailure } from './observability';

const PAID_API_PATHS = new Set([
  '/api/speech-token',
  '/api/translate',
  '/api/gemini-token',
  '/api/gemini-live',
  '/api/detect-question',
  '/api/answer',
]);

export default {
  async fetch(request: Request, env: WorkerEnv, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const finish = (response: Response) => {
      reportServerFailure(env, ctx, url.pathname, response.status);
      return response;
    };
    try {
      if (isApiPath(url.pathname)) {
        const denied = await requireAccess(request, env);
        if (denied) return denied;
        const limited = await checkRateLimits(request, env, url.pathname);
        if (limited) return finish(limited);
        return finish(await routeApi(request, env, url, ctx));
      }
      return finish(await env.ASSETS.fetch(request));
    } catch (err) {
      if (err instanceof InvalidRequestError) return errorJson(err.message, 400);
      logError({
        message: 'unhandled error',
        path: url.pathname,
      });
      return finish(errorJson('Internal server error', 500));
    }
  },
};

async function checkRateLimits(request: Request, env: WorkerEnv, pathname: string): Promise<Response | null> {
  const paid = PAID_API_PATHS.has(pathname);
  const key = request.headers.get('Cf-Access-Authenticated-User-Email')
    || request.headers.get('CF-Connecting-IP')
    || 'unknown';

  try {
    for (const limiter of [env.API_RATE_LIMIT, paid ? env.PAID_API_RATE_LIMIT : undefined]) {
      if (!limiter) continue;
      const { success } = await limiter.limit({ key });
      if (!success) {
        const response = errorJson('Too many requests', 429);
        response.headers.set('Retry-After', '60');
        return response;
      }
    }
  } catch {
    logError({ message: 'rate limiter unavailable', path: pathname });
    if (paid) return errorJson('Rate limiter unavailable', 503);
  }
  return null;
}

async function routeApi(request: Request, env: WorkerEnv, url: URL, ctx?: ExecutionContext): Promise<Response> {
  const { pathname } = url;
  const method = request.method.toUpperCase();
  log({ message: 'api', method, path: pathname });

  if (pathname === '/api/health' && method === 'GET') {
    return json({ ok: true });
  }
  if (pathname === '/api/healthz' && method === 'GET') {
    return handleHealth(env);
  }
  if (pathname === '/api/config' && method === 'GET') {
    return json({
      defaultAnswerModel: env.DEFAULT_ANSWER_MODEL || 'gemini-3.8-flash',
      models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
      templates: SESSION_TEMPLATES.map((t) => ({ id: t.id, label: t.label })),
    });
  }
  if (pathname === '/api/speech-token' && method === 'GET') {
    return handleSpeechToken(env);
  }
  if (pathname === '/api/translate' && method === 'POST') {
    return handleTranslate(request, env);
  }
  if (pathname === '/api/gemini-token' && (method === 'GET' || method === 'POST')) {
    return handleGeminiToken(request, env);
  }
  if (pathname === '/api/gemini-live' && method === 'GET') {
    return handleGeminiLiveProxy(request, env);
  }
  if (pathname === '/api/detect-question' && method === 'POST') {
    return handleDetectQuestion(request, env);
  }
  if (pathname === '/api/answer' && method === 'POST') {
    return handleAnswer(request, env, fetch, undefined, (status) => reportServerFailure(env, ctx, pathname, status, 'stream'));
  }
  if (pathname === '/api/profiles' && method === 'GET') {
    return handleListProfiles(env);
  }
  const profileMatch = pathname.match(/^\/api\/profiles\/([^/]+)$/);
  if (profileMatch) {
    let id: string;
    try {
      id = decodeURIComponent(profileMatch[1] ?? '');
    } catch {
      throw new InvalidRequestError('Invalid profile id encoding');
    }
    if (method === 'GET') return handleGetProfile(env, id);
    if (method === 'PUT') return handlePutProfile(request, env, id);
  }
  return errorJson('Not found', 404);
}
