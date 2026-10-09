import { requireAccess, isApiPath } from './access';
import { handleAnswer } from './answer';
import { handleDetectQuestion } from './detect-question';
import type { WorkerEnv } from './env';
import { handleGeminiLiveProxy, handleGeminiToken } from './gemini';
import { errorJson, json, log, logError } from './http';
import { handleSpeechToken } from './speech-token';
import { handleTranslate } from './translate';

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (isApiPath(url.pathname)) {
        const denied = await requireAccess(request, env);
        if (denied) return denied;
        return await routeApi(request, env, url);
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      logError({
        message: 'unhandled error',
        path: url.pathname,
        error: err instanceof Error ? err.message : String(err),
      });
      return errorJson('Internal server error', 500);
    }
  },
};

async function routeApi(request: Request, env: WorkerEnv, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method.toUpperCase();
  log({ message: 'api', method, path: pathname });

  if (pathname === '/api/health' && method === 'GET') {
    return json({ ok: true });
  }
  if (pathname === '/api/config' && method === 'GET') {
    return json({
      defaultAnswerModel: env.DEFAULT_ANSWER_MODEL || 'claude-opus-5-5',
      models: ['claude-opus-5-5', 'claude-sonnet-5-5'],
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
    return handleAnswer(request, env);
  }
  return errorJson('Not found', 404);
}
