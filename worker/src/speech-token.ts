import type { WorkerEnv } from './env';
import { errorJson, json, logError } from './http';

const TOKEN_TTL_SECONDS = 600;

export async function handleSpeechToken(env: WorkerEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const key = env.AZURE_SPEECH_KEY;
  const region = env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    return errorJson('Azure Speech is not configured', 503);
  }

  const url = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': '0',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    logError({ message: 'azure issueToken failed', status: res.status, body: body.slice(0, 300) });
    return errorJson('Failed to issue Azure Speech token', 502, { status: res.status });
  }

  const token = await res.text();
  return json({
    token,
    region,
    expiresIn: TOKEN_TTL_SECONDS,
  });
}
