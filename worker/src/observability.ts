/// <reference path="./shared-telemetry.d.ts" />
import { createCrashReporter, healthResponse } from 'eugnel-platform/telemetry';
import manifest from '../../package.json';
import type { WorkerEnv } from './env';

const REPORT_TIMEOUT_MS = 2_000;
const ROUTES = new Map([
  ['/api/answer', 'answer'], ['/api/translate', 'translate'],
  ['/api/speech-token', 'speech-token'], ['/api/gemini-token', 'gemini-token'],
  ['/api/gemini-live', 'gemini-live'], ['/api/detect-question', 'detect-question'],
  ['/api/profiles', 'profiles'], ['/api/health', 'health'], ['/api/healthz', 'healthz'],
]);

function routeTag(pathname: string): string {
  return ROUTES.get(pathname) ?? (pathname.startsWith('/api/profiles/') ? 'profile' : 'other');
}

// A deadline also settles transports that ignore AbortSignal. Nothing from a failed
// reporting request is logged or attached to the product response.
const reportFetch: typeof fetch = async (input, init) => {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Response>((_resolve, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error('Reporting deadline reached'));
    }, REPORT_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([
      globalThis.fetch(input, { ...init, signal: abort.signal }), deadline,
    ]);
    void response.body?.cancel().catch(() => undefined);
    return response;
  } finally {
    clearTimeout(timer);
  }
};

export function reportServerFailure(
  env: WorkerEnv,
  ctx: ExecutionContext | undefined,
  pathname: string,
  status: number,
  kind: 'http' | 'stream' = 'http',
): void {
  if (!ctx || !env.SENTRY_DSN || status < 500 || status > 599) return;
  try {
    const sha = /^[a-f0-9]{40}$/.test(env.DEPLOYMENT_SHA ?? '') ? `+${env.DEPLOYMENT_SHA}` : '';
    const reporter = createCrashReporter({
      dsn: env.SENTRY_DSN,
      release: `rtt@${manifest.version}${sha}`,
      environment: 'production',
      fetchImpl: reportFetch,
    });
    // Deliberately do not pass the original error or request. Shared redaction is
    // a second defence; the event starts with a fixed, non-personal allow-list.
    const pending = reporter.capture({ name: 'RttWorkerFailure', message: 'RTT Worker server failure' }, {
      tags: { route: routeTag(pathname), status: String(status), kind },
    }).catch(() => false);
    ctx.waitUntil(pending);
  } catch {
    // Missing/malformed configuration or waitUntil failure cannot break the app.
  }
}

export function handleHealth(env: WorkerEnv): Promise<Response> {
  return healthResponse({
    product: 'rtt',
    version: /^[a-f0-9]{40}$/.test(env.DEPLOYMENT_SHA ?? '')
      ? `${manifest.version}+${env.DEPLOYMENT_SHA}`
      : manifest.version,
    checks: {
      speech: () => Boolean(env.AZURE_SPEECH_KEY || env.GEMINI_API_KEY),
      translation: () => Boolean(env.AZURE_TRANSLATOR_KEY || env.GEMINI_API_KEY),
      answers: () => Boolean(env.GEMINI_API_KEY),
    },
  });
}
