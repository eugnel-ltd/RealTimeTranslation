import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe } from 'eugnel-platform/telemetry';

const ORIGIN = 'https://rtt.eugnel.com';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 20_000;
const TIMED_OUT = Symbol('uptime timeout');

// Bound the complete operation, including response.json(), even if a transport
// does not honour AbortSignal. Report only fixed reasons, never provider data.
async function boundedCheck(check, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(TIMED_OUT);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => check(controller.signal)), deadline]);
  } catch (error) {
    return { healthy: false, reason: error === TIMED_OUT ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

function httpStatus(response) {
  return Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
    ? { status: response.status }
    : {};
}

export async function checkUptime({
  clientId = process.env.RTT_UPTIME_ACCESS_CLIENT_ID,
  clientSecret = process.env.RTT_UPTIME_ACCESS_CLIENT_SECRET,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  expectVersion,
} = {}) {
  if (typeof clientId !== 'string' || !clientId.trim() || typeof clientSecret !== 'string' || !clientSecret.trim()) {
    return { configured: false, healthy: false, exitCode: 2, reason: 'missing_credentials', checks: {} };
  }
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.trunc(timeoutMs)))
    : DEFAULT_TIMEOUT_MS;
  let headers;
  try {
    headers = new Headers({ 'CF-Access-Client-Id': clientId, 'CF-Access-Client-Secret': clientSecret });
  } catch {
    return {
      configured: true, healthy: false, exitCode: 1,
      checks: { homepage: { healthy: false, reason: 'configuration' }, api: { healthy: false, reason: 'configuration' } },
    };
  }

  const [homepage, api] = await Promise.all([
    boundedCheck(async (signal) => {
      const response = await fetchImpl(`${ORIGIN}/`, { headers: new Headers(headers), redirect: 'manual', signal });
      // The page content is not collected or printed by the monitor.
      if (response.body) void response.body.cancel().catch(() => {});
      return { healthy: response.status === 200, ...httpStatus(response), ...(response.status === 200 ? {} : { reason: 'http' }) };
    }, timeout),
    boundedCheck(async (signal) => {
      let status = {};
      let transportFailed = false;
      const result = await probe(`${ORIGIN}/api/healthz`, {
        timeoutMs: timeout,
        expectVersion,
        fetchImpl: async () => {
          try {
            const response = await fetchImpl(`${ORIGIN}/api/healthz`, { headers: new Headers(headers), redirect: 'manual', signal });
            status = httpStatus(response);
            return response;
          } catch (error) {
            transportFailed = true;
            throw error;
          }
        },
      });
      // Shared probe output can include checks and untrusted version strings.
      // Reduce it to a boolean and fixed reason before writing any output.
      return { healthy: result.healthy === true, ...status, ...(result.healthy ? {} : { reason: transportFailed ? 'unreachable' : 'health' }) };
    }, timeout),
  ]);
  const healthy = homepage.healthy && api.healthy;
  return { configured: true, healthy, exitCode: healthy ? 0 : 1, checks: { homepage, api } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkUptime();
  console.log(JSON.stringify(result));
  process.exitCode = result.exitCode;
}
