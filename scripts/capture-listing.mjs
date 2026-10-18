#!/usr/bin/env node
// Capture the existing local interface with synthetic data. No production access.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname);
const input = process.argv[2];
const output = resolve(root, process.argv[3] ?? 'docs/listing/screenshots');
if (!input) throw new Error('Usage: node scripts/capture-listing.mjs http://127.0.0.1:PORT [output-directory]');
const base = new URL(input);
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.protocol !== 'http:' ||
    base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('Capture requires a plain HTTP loopback origin with no credentials, path, query or fragment');
}
const moduleName = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(resolve(moduleName)).href : 'playwright');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim());
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const build = {};
async function inspectBuild(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await inspectBuild(path);
    else if (entry.isFile()) build[relative(root, path)] = hash(await readFile(path));
    else throw new Error('Build must contain regular files only');
  }
}
await inspectBuild(join(root, 'client/dist'));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true });
const evidence = {
  sourceSha: sha, trackedWorkingTreeDirty: dirty, build, browser: browser.version(),
  kind: 'local synthetic evidence, not a deployed release',
  fixture: 'RTT synthetic meeting; no microphone, real person, account or provider calls',
  screenshots: [],
};
const history = [{
  sessionId: 'rtt-listing-synthetic-meeting', timestamp: '2026-10-18T09:00:00.000Z',
  transcriptions: [{
    id: 'rtt-listing-synthetic-line', timestamp: '2026-10-18T09:00:01.000Z',
    originalText: 'Synthetic example: the meeting starts at ten.',
    translatedTexts: ['合成示例：會議十點開始。'], sourceLanguage: 'en-GB', targetLanguages: ['zh-HK'],
  }],
}];
try {
  for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Europe/London', serviceWorkers: 'block', colorScheme: 'light' });
    const refused = [];
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base.origin || request.method() !== 'GET') {
        refused.push('nonlocal or mutating request');
        await route.abort();
      } else if (url.pathname === '/api/account') {
        await route.fulfill({ json: { enabled: false } });
      } else if (url.pathname === '/api/config') {
        await route.fulfill({ json: { defaultAnswerModel: 'gemini-3.8-flash', models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'] } });
      } else if (url.pathname === '/api/profiles') {
        await route.fulfill({ json: { profiles: [] } });
      } else if (url.pathname.startsWith('/api/')) {
        refused.push('unexpected API request');
        await route.abort();
      } else {
        // Browser interception does not recheck redirect targets. Fetch without following.
        const response = await route.fetch({ maxRedirects: 0, timeout: 5000 });
        if (response.status() >= 300 && response.status() < 400) {
          refused.push('redirected local asset');
          await route.abort();
        } else {
          await route.fulfill({ response });
        }
      }
    });
    await context.addInitScript(({ savedHistory }) => {
      localStorage.clear();
      localStorage.setItem('user_settings', JSON.stringify({ theme: 'light', profileId: '', inputLanguage: 'en-GB', outputLanguage: 'zh-HK', secondOutputLanguage: '', autoDetect: false }));
      localStorage.setItem('transcriptionHistory', JSON.stringify(savedHistory));
    }, { savedHistory: history });
    const page = await context.newPage();
    await page.goto(base.origin, { waitUntil: 'networkidle' });
    if (refused.length) throw new Error('Capture refused unexpected requests before accepting assets');
    await page.getByRole('heading', { name: 'Real-Time Translator', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const view of ['session', 'history']) {
      if (view === 'history') {
        await page.getByRole('button', { name: 'History', exact: true }).click();
        await page.getByRole('button', { name: /1 transcription/ }).click();
        await page.getByText('Synthetic example: the meeting starts at ten.', { exact: true }).waitFor();
      }
      const file = `${device}-${view}.png`;
      const bytes = await page.screenshot({ path: join(output, file), fullPage: true, animations: 'disabled' });
      evidence.screenshots.push({ file, viewport: { width, height }, sha256: hash(bytes), bytes: bytes.length, caption: view === 'history' ? 'Review a transcript saved in this browser (synthetic example).' : 'Choose a session template in the existing interface.' });
    }
    await context.close();
    if (refused.length) throw new Error(`Capture refused ${refused.length} unexpected requests; no assets accepted`);
  }
  await writeFile(join(output, 'capture.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`listing capture: ${evidence.screenshots.length} local synthetic screenshots; source ${sha}; tracked dirty=${dirty}`);
} finally {
  await browser.close();
}
