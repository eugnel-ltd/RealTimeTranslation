import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it.each([
  ['provider error', 'event: error\ndata: {"error":"synthetic provider quota"}\n\n', false],
  ['incomplete stream', 'event: token\ndata: {"text":"partial"}\n\n', false],
  ['completed CRLF stream', 'event: token\r\ndata: {"text":"answer"}\r\n\r\nevent: done\r\ndata: {}', true],
])('reports replay success accurately for %s', async (_name, events, success) => {
  const dir = await mkdtemp(join(tmpdir(), 'rtt-replay-'));
  const input = join(dir, 'transcript.json');
  await writeFile(input, JSON.stringify({ segments: [{ index: 0, text: 'Why?' }] }));
  const server = createServer((req, res) => {
    if (req.url === '/api/answer') res.end(String(events));
    else res.end(JSON.stringify({ shouldAnswer: true, question: 'Why?', segmentIndex: 0 }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test server address');
  try {
    const result = await new Promise<{ failed: boolean; stdout: string; stderr: string }>((resolve) => {
      execFile(process.execPath, [fileURLToPath(new URL('../scripts/replay-transcript.mjs', import.meta.url)), input, '--answer'], {
        env: { ...process.env, SMOKE_BASE_URL: `http://127.0.0.1:${address.port}`, SMOKE_ACCESS_JWT: '' }, timeout: 3000,
      }, (error, stdout, stderr) => resolve({ failed: Boolean(error), stdout, stderr }));
    });
    expect(result.failed).toBe(!success);
    if (success) expect(result.stdout).toContain('answer');
    else expect(result.stderr).toMatch(/synthetic provider quota|before.*done/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
