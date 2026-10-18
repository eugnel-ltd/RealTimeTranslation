#!/usr/bin/env node
/**
 * Replay a timestamped transcript through detect-question (and optionally /api/answer).
 *
 *   npx wrangler dev          # .dev.vars with real keys, SKIP_ACCESS_CHECK=true
 *   node scripts/replay-transcript.mjs path/to/transcript.json
 *   node scripts/replay-transcript.mjs path/to/transcript.json --answer
 *
 * JSON shape:
 * {
 *   "segments": [{ "index": 0, "text": "...", "timestamp": "2026-10-11T12:00:00.000Z" }],
 *   "threshold": 0.6,
 *   "windowSeconds": 120,
 *   "lastAnsweredQuestion": null,
 *   "templateId": "interview-competency",
 *   "profileId": "james"
 * }
 *
 * Env: SMOKE_BASE_URL (default http://127.0.0.1:8787), SMOKE_ACCESS_JWT
 */
import { readFileSync } from 'node:fs';

const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const accessHeaders = process.env.SMOKE_ACCESS_JWT
  ? { 'Cf-Access-Jwt-Assertion': process.env.SMOKE_ACCESS_JWT }
  : {};

const args = process.argv.slice(2).filter((a) => a !== '--answer');
const wantAnswer = process.argv.includes('--answer');
const file = args[0];
if (!file) {
  console.error('Usage: node scripts/replay-transcript.mjs <transcript.json> [--answer]');
  process.exit(1);
}

const payload = JSON.parse(readFileSync(file, 'utf8'));
const segments = payload.segments;
if (!Array.isArray(segments) || segments.length === 0) {
  console.error('transcript JSON must have a non-empty segments array');
  process.exit(1);
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...accessHeaders },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { res, text };
}

const detectBody = {
  segments,
  threshold: payload.threshold ?? 0.6,
  windowSeconds: payload.windowSeconds ?? 120,
  lastAnsweredQuestion: payload.lastAnsweredQuestion ?? null,
};

const auto = await post('/api/detect-question', detectBody);
console.log('A detect-question', auto.res.status, auto.text.slice(0, 2000));
let autoJson;
try {
  autoJson = JSON.parse(auto.text);
} catch {
  autoJson = null;
}

const start = await post('/api/detect-question', { ...detectBody, mode: 'question-start' });
console.log('B question-start', start.res.status, start.text.slice(0, 2000));
let startJson;
try {
  startJson = JSON.parse(start.text);
} catch {
  startJson = null;
}

const startIndex = startJson?.segmentIndex ?? autoJson?.segmentIndex ?? null;
const sliced =
  startIndex == null
    ? segments
    : segments.slice(Math.max(0, segments.findIndex((s) => s.index === startIndex)));
const conversation = sliced
  .map((s) => String(s.text ?? '').trim())
  .filter(Boolean)
  .join('\n');
console.log(
  JSON.stringify(
    {
      shouldAnswer: autoJson?.shouldAnswer ?? null,
      autoHint: autoJson?.question ?? null,
      startIndex,
      extractChars: conversation.length,
      fallbackFullWindow: startIndex == null,
    },
    null,
    2,
  ),
);

if (!wantAnswer) process.exit(auto.res.ok ? 0 : 1);

const answer = await post('/api/answer', {
  conversation,
  extractQuestion: true,
  questionHint: autoJson?.question ?? undefined,
  previousQuestion: payload.lastAnsweredQuestion ?? undefined,
  templateId: payload.templateId ?? 'interview-competency',
  profileId: payload.profileId,
  answerLanguage: payload.answerLanguage ?? 'en',
  force: true,
  model: payload.model,
});
if (!answer.res.ok) {
  console.error('answer failed', answer.res.status, answer.text.slice(0, 800));
  process.exit(1);
}
let question = '';
let tokens = '';
let completed = false;
for (const block of answer.text.split(/\r?\n\r?\n/)) {
  const event = block.split(/\r?\n/).find((l) => l.startsWith('event: '))?.slice(7).trim();
  const dataLine = block.split(/\r?\n/).find((l) => l.startsWith('data: '));
  if (!event || !dataLine) continue;
  let data = {};
  try {
    data = JSON.parse(dataLine.slice(6));
  } catch {
    data = {};
  }
  if (event === 'error') {
    console.error('answer failed:', String(data.error ?? 'provider stream error'));
    process.exit(1);
  }
  if (event === 'done') completed = true;
  if (event === 'question') question = String(data.question ?? '');
  if (event === 'token') tokens += String(data.text ?? '');
}
if (!completed) {
  console.error('answer failed: stream ended before done');
  process.exit(1);
}
console.log('--- extracted question ---');
console.log(question);
console.log('--- answer ---');
console.log(tokens.trim());
