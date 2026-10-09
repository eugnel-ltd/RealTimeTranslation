#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../client/dist', import.meta.url).pathname;
const forbidden = [
  /VITE_AZURE_SPEECH_KEY/,
  /VITE_AZURE_SPEECH_REGION/,
  /AZURE_SPEECH_KEY/,
  /AZURE_TRANSLATOR_KEY/,
  /GEMINI_API_KEY/,
  /ANTHROPIC_API_KEY/,
  /TYPESAFE_API_KEY/,
  /sk-ant-[a-zA-Z0-9_-]{20,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(js|mjs|css|html|map)$/.test(name)) out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(dist);
} catch {
  console.error('verify-bundle: client/dist missing. Run the client build first.');
  process.exit(1);
}

const hits = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const re of forbidden) {
    if (re.test(text)) hits.push(`${file}: ${re}`);
  }
}

if (hits.length) {
  console.error('verify-bundle: possible secrets in client bundle:');
  for (const hit of hits) console.error(' -', hit);
  process.exit(1);
}

console.log(`verify-bundle: ok (${files.length} files, no secret patterns)`);
