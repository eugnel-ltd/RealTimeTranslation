#!/usr/bin/env node
/**
 * Hit a locally running Worker (`npx wrangler dev`) with real keys in `.dev.vars`.
 *
 *   SKIP_ACCESS_CHECK=true npx wrangler dev
 *   node scripts/smoke.mjs
 *
 * Optional env:
 *   SMOKE_BASE_URL  (default http://127.0.0.1:8787)
 *   SMOKE_ACCESS_JWT  Cf-Access-Jwt-Assertion if Access is on
 */
const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const accessHeaders = process.env.SMOKE_ACCESS_JWT
  ? { 'Cf-Access-Jwt-Assertion': process.env.SMOKE_ACCESS_JWT }
  : {};

const results = [];

function ms(start) {
  return Math.round(performance.now() - start);
}

async function run(name, fn) {
  const start = performance.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: ms(start), detail });
    console.log(`OK   ${name}  ${ms(start)}ms  ${detail ?? ''}`);
  } catch (err) {
    results.push({ name, ok: false, ms: ms(start), detail: err instanceof Error ? err.message : String(err) });
    console.error(`FAIL ${name}  ${ms(start)}ms  ${err instanceof Error ? err.message : err}`);
  }
}

async function req(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...accessHeaders, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, text, json };
}

function assertOk(res, json, extra) {
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json) || extra || ''}`);
  }
}

await run('GET /api/health', async () => {
  const { res, json } = await req('/api/health');
  assertOk(res, json);
  if (!json?.ok) throw new Error('expected {ok:true}');
  return 'ok';
});

await run('GET /api/config', async () => {
  const { res, json } = await req('/api/config');
  assertOk(res, json);
  return json.defaultAnswerModel;
});

await run('GET /api/speech-token', async () => {
  const { res, json } = await req('/api/speech-token');
  assertOk(res, json);
  if (!json?.token || !json?.region) throw new Error('missing token/region');
  return `region=${json.region} tokenBytes=${json.token.length}`;
});

await run('POST /api/translate', async () => {
  const { res, json } = await req('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'Hello, how are you?',
      from: 'en-US',
      to: ['yue', 'zh-CN'],
    }),
  });
  assertOk(res, json);
  if (!Array.isArray(json?.translations) || json.translations.length < 2) {
    throw new Error('expected two translations');
  }
  return `provider=${json.provider}`;
});

await run('GET /api/gemini-token?mode=transcribe', async () => {
  const { res, json } = await req('/api/gemini-token?mode=transcribe');
  assertOk(res, json);
  if (!json?.token || !json?.wsUrl) throw new Error('missing token/wsUrl');
  return json.model;
});

await run('POST /api/gemini-token translate', async () => {
  const { res, json } = await req('/api/gemini-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'translate', targetLanguage: 'yue' }),
  });
  assertOk(res, json);
  return json.model;
});

await run('GET /api/gemini-live (upgrade check)', async () => {
  const { res, text } = await req('/api/gemini-live');
  if (res.status !== 426) throw new Error(`expected 426 without Upgrade, got ${res.status} ${text.slice(0, 80)}`);
  return '426 without websocket';
});

await run('POST /api/detect-question', async () => {
  const { res, json } = await req('/api/detect-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      windowSeconds: 60,
      threshold: 0.7,
      lastAnsweredQuestion: null,
      segments: [
        { index: 0, text: 'Thanks for coming in today.' },
        { index: 1, text: 'Tell me about a time you resolved a production incident.' },
      ],
    }),
  });
  assertOk(res, json);
  return `detector=${json.detector} shouldAnswer=${json.shouldAnswer}`;
});

async function smokeAnswer(model) {
  const start = performance.now();
  const res = await fetch(`${BASE}/api/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...accessHeaders },
    body: JSON.stringify({
      model,
      force: true,
      answerLanguage: 'en',
      question: 'What is your greatest strength?',
      conversation: 'Interviewer: What is your greatest strength?',
      userContext: 'Backend engineer, 8 years, TypeScript and Cloudflare Workers.',
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let ttft = null;
  let tokens = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      const event = part.split('\n').find((l) => l.startsWith('event: '))?.slice(7);
      if (event === 'token' && ttft == null) ttft = Math.round(performance.now() - start);
      if (event === 'token' && line) {
        try {
          tokens += JSON.parse(line.slice(6)).text ?? '';
        } catch {
          /* ignore */
        }
      }
      if (event === 'error') throw new Error(line ?? 'stream error');
    }
  }
  if (ttft == null) throw new Error('no token events');
  return `ttft=${ttft}ms chars=${tokens.length}`;
}

await run('POST /api/answer claude-opus-5-5 TTFT', () => smokeAnswer('claude-opus-5-5'));
await run('POST /api/answer claude-sonnet-5-5 TTFT', () => smokeAnswer('claude-sonnet-5-5'));

const failed = results.filter((r) => !r.ok);
console.log('\n' + JSON.stringify(results, null, 2));
if (failed.length) {
  console.error(`\n${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n${results.length} checks passed`);
