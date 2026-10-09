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
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

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

await run('WS /api/gemini-live setupComplete', async () => {
  const text = await geminiLiveSetupComplete();
  if (text === '[object Blob]') throw new Error('proxy forwarded Blob as string');
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`expected JSON, got ${text.slice(0, 120)}`);
  }
  if (!json.setupComplete) throw new Error(`expected setupComplete, got ${text.slice(0, 200)}`);
  return 'setupComplete';
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

async function smokeAnswerRaw(model, extra = {}) {
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
      userContext: 'Interviewing for a Staff engineer role on a Cloudflare Workers platform team.',
      extraNotes: 'Emphasise incident response.',
      templateId: 'interview-competency',
      ...extra,
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
  let usage = {};
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
      if (event === 'usage' && line) {
        try {
          usage = JSON.parse(line.slice(6));
        } catch {
          /* ignore */
        }
      }
      if (event === 'error') throw new Error(line ?? 'stream error');
    }
  }
  if (ttft == null) throw new Error('no token events');
  return { ttft, chars: tokens.length, usage };
}

async function smokeAnswer(model, extra = {}) {
  const r = await smokeAnswerRaw(model, extra);
  return `ttft=${r.ttft}ms chars=${r.chars}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function syntheticProfileMarkdown(targetBytes) {
  const line = 'Synthetic filler for prompt-cache measurement. Not a real CV. TypeScript, Workers, interviews.\n';
  let out = '# Synthetic profile\n\n';
  while (Buffer.byteLength(out) < targetBytes) out += line;
  return out;
}

await run('GET /api/profiles', async () => {
  const { res, json } = await req('/api/profiles');
  assertOk(res, json);
  const ids = (json.profiles ?? []).map((p) => p.id).sort().join(',');
  if (!ids.includes('james') || !ids.includes('wing')) throw new Error(`expected james,wing got ${ids}`);
  return ids;
});

await run('GET /api/profiles/james', async () => {
  const { res, json } = await req('/api/profiles/james');
  assertOk(res, json);
  if (json.id !== 'james') throw new Error(`expected james, got ${json.id}`);
  return `bytes=${Buffer.byteLength(json.markdown ?? '')}`;
});

await run('PUT /api/profiles/james synthetic 25KB if empty', async () => {
  const existing = await req('/api/profiles/james');
  assertOk(existing.res, existing.json);
  const bytes = Buffer.byteLength(existing.json.markdown ?? '');
  if (bytes > 0) return `kept existing bytes=${bytes}`;
  const local = /127\.0\.0\.1|localhost/.test(BASE);
  if (!local && process.env.SMOKE_SEED_PROFILE !== '1') {
    return 'skipped seed (not local; set SMOKE_SEED_PROFILE=1 to write synthetic)';
  }
  const markdown = syntheticProfileMarkdown(25_000);
  const { res, json } = await req('/api/profiles/james', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'James', markdown }),
  });
  assertOk(res, json);
  if ((json.bytes ?? 0) < 20_000) throw new Error(`expected ~25KB, got ${json.bytes}`);
  return `seeded bytes=${json.bytes}`;
});

await run('POST /api/answer claude-opus-5-5 TTFT', () => smokeAnswer('claude-opus-5-5'));
await run('POST /api/answer claude-sonnet-5-5 TTFT', () => smokeAnswer('claude-sonnet-5-5'));

await run('POST /api/answer opus profile cache write TTFT', async () => {
  const r = await smokeAnswerRaw('claude-opus-5-5', { profileId: 'james' });
  return `ttft=${r.ttft}ms cache_write=${r.usage.cache_creation_input_tokens ?? 0} cache_read=${r.usage.cache_read_input_tokens ?? 0}`;
});

await run('POST /api/answer opus profile cache read TTFT', async () => {
  await sleep(2000);
  const r = await smokeAnswerRaw('claude-opus-5-5', { profileId: 'james' });
  return `ttft=${r.ttft}ms cache_write=${r.usage.cache_creation_input_tokens ?? 0} cache_read=${r.usage.cache_read_input_tokens ?? 0}`;
});

const failed = results.filter((r) => !r.ok);
console.log('\n' + JSON.stringify(results, null, 2));
if (failed.length) {
  console.error(`\n${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n${results.length} checks passed`);

async function geminiLiveSetupComplete() {
  const origin = new URL(BASE);
  const isTls = origin.protocol === 'https:';
  const key = crypto.randomBytes(16).toString('base64');
  const setup = JSON.stringify({
    setup: {
      model: 'models/gemini-3.5-transcribe-live',
      generationConfig: { responseModalities: ['TEXT'] },
      inputAudioTranscription: { languageCodes: [] },
    },
  });

  const socket = await new Promise((resolve, reject) => {
    const req = (isTls ? https : http).request({
      hostname: origin.hostname,
      port: origin.port || (isTls ? 443 : 80),
      path: '/api/gemini-live?mode=transcribe',
      method: 'GET',
      headers: {
        Host: origin.host,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
        ...accessHeaders,
      },
    });
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('websocket timeout'));
    }, 15000);
    req.on('upgrade', (_res, sock) => {
      clearTimeout(timer);
      resolve(sock);
    });
    req.on('response', (res) => {
      clearTimeout(timer);
      reject(new Error(`websocket HTTP ${res.statusCode}`));
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });

  try {
    sendWsText(socket, setup);
    return await readWsText(socket, 15000);
  } finally {
    socket.destroy();
  }
}

function sendWsText(socket, text) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x81;
    header[1] = 0x80 | payload.length;
    mask.copy(header, 2);
  } else {
    header = Buffer.alloc(8);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
    mask.copy(header, 4);
  }
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  socket.write(Buffer.concat([header, masked]));
}

function readWsText(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error('no websocket frame')), timeoutMs);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const frame = parseWsFrame(buf);
      if (!frame) return;
      clearTimeout(timer);
      if (frame.text === '[object Blob]') {
        reject(new Error('proxy forwarded Blob as string'));
        return;
      }
      resolve(frame.text);
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      reject(new Error('websocket closed before setupComplete'));
    });
  });
}

function parseWsFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  if (opcode === 0x8) return { text: '' };
  let len = buf[1] & 0x7f;
  const masked = (buf[1] & 0x80) !== 0;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  if (masked) {
    if (buf.length < offset + 4 + len) return null;
    const mask = buf.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(buf.subarray(offset, offset + len));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    return { text: payload.toString('utf8') };
  }
  if (buf.length < offset + len) return null;
  return { text: buf.subarray(offset, offset + len).toString('utf8') };
}
