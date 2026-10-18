import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const clientPackage = fileURLToPath(new URL('../client/package.json', import.meta.url));
const child = String.raw`
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { realpathSync } = require('node:fs');
const requireClient = createRequire(process.argv[1]);
const fromMicromatch = createRequire(requireClient.resolve('micromatch')).resolve('braces');
const fromChokidar = createRequire(requireClient.resolve('chokidar')).resolve('braces');
const braces = require(process.env.RTT_BRACES_BASELINE || fromMicromatch);
const action = process.argv[2];
const api = process.argv[3];
const mode = process.argv[4];
const invoke = input => api === 'main' ? braces(input) : braces[api](input);
function pattern(depth, kind) {
  const open = kind === 'paren' ? '(' : kind === 'mixed' ? '{(' : '{';
  const close = kind === 'paren' ? ')' : kind === 'mixed' ? ')}' : '}';
  return open.repeat(depth) + 'a' + close.repeat(depth);
}
function ast(depth) {
  let node = { type: 'text', value: 'a' };
  for (let i = 0; i < depth; i++) {
    const parent = { type: 'paren', nodes: [node] };
    node.parent = parent;
    node = parent;
  }
  const root = { type: 'root', nodes: [node] };
  node.parent = root;
  return root;
}
if (action === 'string') {
  const input = pattern(mode === 'mixed' ? 2000 : 4000, mode);
  assert.ok(input.length < 10000, 'fixture must remain below the existing character cap');
  assert.throws(() => invoke(input), error =>
    error instanceof SyntaxError && /^Input depth \(101\), exceeds max depth \(100\)$/.test(error.message),
    'deeply nested patterns must reject before native stack exhaustion');
} else if (action === 'ast') {
  assert.throws(() => invoke(ast(10000)), error =>
    error instanceof RangeError && /^AST depth \(101\), exceeds max depth \(100\)$/.test(error.message),
    'direct deep ASTs must reject before native stack exhaustion');
} else if (action === 'cycle') {
  const node = { type: 'paren', nodes: [] };
  node.parent = mode === 'self' ? node : { type: 'paren', nodes: [], parent: node };
  assert.throws(() => braces.expand({ type: 'root', nodes: [node] }),
    /AST parent chain contains a cycle/, 'cyclic parent traversal must terminate');
} else if (action === 'boundary') {
  for (const method of ['parse', 'compile', 'expand', 'stringify']) {
    for (const kind of ['brace', 'paren']) {
      assert.doesNotThrow(() => braces[method](pattern(100, kind)), method + ' must allow depth100');
      assert.throws(() => braces[method](pattern(101, kind)),
        /Input depth \(101\), exceeds max depth \(100\)/, method + ' must reject depth101');
    }
  }
} else if (action === 'compatibility') {
  assert.deepEqual(braces('src/**/*.{js,ts,jsx,tsx}'), ['src/**/*.(js|ts|jsx|tsx)']);
  assert.deepEqual(braces.expand('src/**/*.{js,ts,jsx,tsx}'),
    ['src/**/*.js', 'src/**/*.ts', 'src/**/*.jsx', 'src/**/*.tsx']);
  assert.deepEqual(braces.expand('a/{01..03}/b'), ['a/01/b', 'a/02/b', 'a/03/b']);
  assert.deepEqual(braces.expand('a/{b,{c,d}}/e'), ['a/b/e', 'a/c/e', 'a/d/e']);
  assert.deepEqual(braces.expand('a/\\{b,c\\}/d'), ['a/{b,c}/d']);
  assert.equal(braces.stringify(braces.parse('a/{b,c}/d')), 'a/{b,c}/d');
  assert.equal(braces.compile('"' + '{'.repeat(200) + '"'), '{'.repeat(200));
  assert.equal(braces.compile('\\{'.repeat(200)), '{'.repeat(200));
  assert.deepEqual(braces(['a/{b,c}', 'd/{e,f}'], { expand: true }), ['a/b', 'a/c', 'd/e', 'd/f']);
  assert.deepEqual(braces.expand('{a,a,}', { nodupes: true, noempty: true }), ['a']);
} else if (action === 'resolution') {
  assert.equal(realpathSync(fromMicromatch), realpathSync(fromChokidar),
    'both transitive consumers must use the same patched dependency');
  assert.match(realpathSync(fromMicromatch).replaceAll('\\', '/'), /\/client\/vendor\/braces\/index\.js$/,
    'transitive consumers must resolve the reviewed local runtime');
} else {
  throw new Error('Unknown regression action');
}
console.log('bounded braces regression passed');
`;

function check(action: string, api = '', mode = '') {
  const result = spawnSync(process.execPath,
    ['--stack-size=256', '--max-old-space-size=128', '-e', child, clientPackage, action, api, mode],
    { encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 16384 });
  expect(result.error, `${action}/${api}/${mode}: child exceeded its deadline`).toBeUndefined();
  expect(result.signal, `${action}/${api}/${mode}: child was terminated`).toBeNull();
  expect(result.status, `${action}/${api}/${mode}: ${result.stderr}`).toBe(0);
  expect(result.stdout).toContain('bounded braces regression passed');
}

describe('installed braces stack-exhaustion remediation', () => {
  for (const mode of ['brace', 'paren', 'mixed']) {
    it(`rejects deep ${mode} patterns with a controlled parse limit`, () => check('string', 'compile', mode));
  }
  for (const api of ['parse', 'expand', 'stringify', 'main']) {
    it(`guards nested string input through ${api}`, () => check('string', api, 'brace'));
  }
  for (const api of ['compile', 'expand', 'stringify']) {
    it(`guards direct deep ASTs through ${api}`, () => check('ast', api));
  }
  for (const mode of ['self', 'two-node']) {
    it(`terminates ${mode} parent cycles during expansion`, () => check('cycle', '', mode));
  }
  it('allows depth100 and rejects depth101 across processors', () => check('boundary'));
  it('preserves controlled-glob, range, escaping, quote and array behaviour', () => check('compatibility'));
  it('routes both transitive consumers to the reviewed local runtime', () => check('resolution'));
});
