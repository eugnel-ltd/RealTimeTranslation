import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React from '../client/node_modules/react';
import App from '../client/src/App';
import { SettingsService } from '../client/src/services/settings';
import { joinSegmentText, wordCount } from '../shared/extractWindow';

const api = vi.hoisted(() => ({ answer: vi.fn(), detect: vi.fn(), callbacks: null as any }));
vi.mock('../client/src/services/api', () => ({
  streamAnswer: api.answer,
  detectQuestion: api.detect,
  fetchPublicConfig: async () => ({}),
}));
vi.mock('../client/src/services/speechController', () => ({
  SpeechController: class {
    constructor(callbacks: any) { api.callbacks = callbacks; }
    async start() {}
    async stop() {}
  },
}));

// Run App's actual hooks and handlers; child elements expose their public callback props.
let slots: any[];
let cursor: number;
let effects: Array<() => void>;
let dirty: boolean;
let tree: any;
const internals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
function memo(factory: () => any, deps: any[]) {
  const id = cursor++;
  if (!slots[id] || deps.some((dep, i) => dep !== slots[id].deps[i])) slots[id] = { value: factory(), deps };
  return slots[id].value;
}
const dispatcher = {
  useState(initial: any) {
    const id = cursor++;
    if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial;
    return [slots[id], (next: any) => {
      const value = typeof next === 'function' ? next(slots[id]) : next;
      if (!Object.is(value, slots[id])) dirty = true;
      slots[id] = value;
    }];
  },
  useRef(initial: any) { const id = cursor++; return slots[id] ??= { current: initial }; },
  useMemo: memo,
  useCallback: (fn: any, deps: any[]) => memo(() => fn, deps),
  useEffect(fn: () => void, deps?: any[]) {
    const id = cursor++;
    if (!deps || !slots[id] || deps.some((dep, i) => dep !== slots[id].deps[i])) {
      effects.push(() => { slots[id]?.cleanup?.(); slots[id] = { deps, cleanup: fn() }; });
    }
  },
};
function render() {
  for (let pass = 0; pass < 20; pass++) {
    cursor = 0; effects = []; dirty = false;
    internals.ReactCurrentDispatcher.current = dispatcher;
    try { tree = App({}); } finally { internals.ReactCurrentDispatcher.current = null; }
    effects.forEach((effect) => effect());
    if (!dirty) return;
  }
  throw new Error('App did not settle');
}
function props(name: string, node = tree): any {
  if (!node || typeof node !== 'object') return;
  if (node.type?.name === name) return node.props;
  for (const child of [node.props?.children].flat(Infinity)) {
    if (child == null) continue;
    const found = props(name, child);
    if (found) return found;
  }
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); render(); }
async function advance(ms: number) { await vi.advanceTimersByTimeAsync(ms); await flush(); }
function emit(text: string) { api.callbacks.onRecognized(text, []); render(); }
function part(label: string, words: number) {
  return [label, ...Array.from({ length: words - 1 }, (_, i) => label + '_' + i)].join(' ');
}
async function triggerAnswer() { await advance(400); await advance(1500); }
function answerBody() { return api.answer.mock.calls.at(-1)?.[0]; }
function assertDetectorBudget() {
  for (const [body] of api.detect.mock.calls) expect(wordCount(joinSegmentText(body.segments))).toBeLessThanOrEqual(500);
}

beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T12:00:00Z')); vi.clearAllMocks();
  slots = []; (SettingsService as any).instance = undefined;
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  api.detect.mockImplementation(async (body: any) => body.mode === 'question-start'
    ? { segmentIndex: 0, detector: 'jev' }
    : { shouldAnswer: true, question: 'Case question?', detector: 'jev', probabilities: {} });
  api.answer.mockImplementation(async (_body: any, event: any) => {
    event('question', { question: 'Case question?' });
    event('token', { text: 'Complete answer.' }); event('done', {});
  });
  render(); await props('Header').onToggleRecording(); render();
});
afterEach(() => {
  for (const slot of slots) slot?.cleanup?.();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('tail replacements retain every middle subpart of a question longer than the detector word budget', async () => {
  const chunks = [part('PREAMBLE', 40), part('PART_A_CAPACITY', 350), part('PART_B_RECOVERY', 350), part('PART_C_COST', 20)];
  emit(chunks[0]); await triggerAnswer();
  expect(api.answer).toHaveBeenCalledTimes(1);
  for (const chunk of chunks.slice(1)) { emit(chunk); await flush(); }
  expect(api.answer).toHaveBeenCalledTimes(4);
  expect(answerBody().conversation).toBe(chunks.join('\n'));
  expect(answerBody().extractQuestion).toBe(true);
  expect(api.detect.mock.calls.filter(([body]) => body.mode === 'question-start')).toHaveLength(1);
  assertDetectorBudget();
});

it('initial extraction keeps continuation segments received while question-start detection is pending', async () => {
  let resolve!: (value: any) => void;
  api.detect.mockImplementation((body: any) => body.mode === 'question-start'
    ? new Promise((done) => { resolve = done; })
    : Promise.resolve({ shouldAnswer: true, question: 'Case question?', detector: 'jev', probabilities: {} }));
  const chunks = [part('CASE_SETUP', 40), part('FIRST_REQUIRED_SUBPART', 350), part('SECOND_REQUIRED_SUBPART', 350)];
  emit(chunks[0]); await triggerAnswer();
  expect(resolve).toEqual(expect.any(Function));
  emit(chunks[1]); emit(chunks[2]);
  resolve({ segmentIndex: 0, detector: 'jev' }); await flush();
  expect(api.answer).toHaveBeenCalledTimes(1);
  expect(answerBody().conversation).toBe(chunks.join('\n'));
  assertDetectorBudget();
});

it('unknown-start extraction keeps the complete time window while detector requests stay word-capped', async () => {
  api.detect.mockImplementation(async (body: any) => body.mode === 'question-start'
    ? { segmentIndex: null, detector: 'fallback' }
    : { shouldAnswer: true, question: 'Case question?', detector: 'jev', probabilities: {} });
  const chunks = [part('FULL_PREAMBLE', 200), part('MIDDLE_REQUIREMENTS', 350), part('LAST_SUBPART', 350)];
  for (const chunk of chunks) emit(chunk);
  await triggerAnswer();
  expect(api.answer).toHaveBeenCalledTimes(1);
  expect(answerBody().conversation).toBe(chunks.join('\n'));
  expect(api.detect).toHaveBeenCalledTimes(2);
  assertDetectorBudget();
});

it('a known question start cannot pull transcript older than three minutes into extraction', async () => {
  let resolve!: (value: any) => void;
  api.detect.mockImplementation((body: any) => body.mode === 'question-start'
    ? new Promise((done) => { resolve = done; })
    : Promise.resolve({ shouldAnswer: true, question: 'Case question?', detector: 'jev', probabilities: {} }));
  emit('EXPIRED_PREAMBLE'); await triggerAnswer();
  await advance(181_000);
  emit('CURRENT_SUBPART');
  resolve({ segmentIndex: 0, detector: 'jev' }); await flush();
  expect(api.answer).toHaveBeenCalledTimes(1);
  expect(answerBody().conversation).toBe('CURRENT_SUBPART');
});
