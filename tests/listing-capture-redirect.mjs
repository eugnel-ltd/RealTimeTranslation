// Real-browser regression for the capture command's no-external-request boundary.
// Requires the same Playwright/Chromium configuration as scripts/capture-listing.mjs.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
let targetHits = 0;
const target = http.createServer((_request, response) => {
  targetHits++;
  response.setHeader('Content-Type', 'text/css');
  response.end('/* redirected target must never receive this request */');
});
await new Promise(done => target.listen(0, '127.0.0.1', done));
const targetOrigin = `http://127.0.0.1:${target.address().port}`;
const source = http.createServer(async (request, response) => {
  if (request.url === '/redirect.css') {
    response.writeHead(302, { Location: `${targetOrigin}/leak.css` });
    return response.end();
  }
  const html = await readFile(join(root, 'client/dist/index.html'), 'utf8');
  response.setHeader('Content-Type', 'text/html');
  // The heading lets the old command finish its first screenshot promptly.
  // Its remaining requests deliberately fail after the target hit is observable.
  response.end(html.replace('</head>', '<link rel="stylesheet" href="/redirect.css"></head>')
    .replace('<div id="root"></div>', '<h1>Real-Time Translator</h1>'));
});
await new Promise(done => source.listen(0, '127.0.0.1', done));
const output = await mkdtemp(join(tmpdir(), 'rtt-listing-redirect-'));
try {
  const child = spawn(process.execPath, ['scripts/capture-listing.mjs', `http://127.0.0.1:${source.address().port}`, output], { cwd: root, stdio: 'ignore', env: process.env });
  const timer = setTimeout(() => child.kill('SIGTERM'), 8000);
  const result = await new Promise((done, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => done({ code, signal }));
  }).finally(() => clearTimeout(timer));
  assert.equal(targetHits, 0, 'Redirect targets must receive no request from the real capture command');
  assert.equal(result.signal, null, 'Capture must refuse a redirect without a timeout');
  assert.notEqual(result.code, 0, 'Capture must reject assets from a redirected origin');
  console.log('listing capture redirect boundary: pass');
} finally {
  await rm(output, { recursive: true, force: true });
  source.closeAllConnections();
  target.closeAllConnections();
  await new Promise(done => source.close(done));
  await new Promise(done => target.close(done));
}
