import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React from '../client/node_modules/react';
import App from '../client/src/App';

const api = vi.hoisted(() => ({ answer: vi.fn(), detect: vi.fn(), callbacks: null as any }));
vi.mock('../client/src/services/api', () => ({
  streamAnswer: api.answer,
  detectQuestion: api.detect,
  fetchPublicConfig: async () => ({}),
}));
vi.mock('../client/src/services/speechController', () => ({
  SpeechController: class {
    constructor(callbacks: unknown) { api.callbacks = callbacks; }
    async start() {}
    async stop() {}
  },
}));

// Exercise App's handlers and effects in Node without rendering child components.
// Slots follow React hook ordering; dependency checks preserve memo and effect lifetimes.
let slots: any[];
let cursor: number;
let effects: Array<() => void>;
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
    return [slots[id], (next: any) => { slots[id] = typeof next === 'function' ? next(slots[id]) : next; }];
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
  cursor = 0; effects = [];
  internals.ReactCurrentDispatcher.current = dispatcher;
  try { tree = App({}); } finally { internals.ReactCurrentDispatcher.current = null; }
  effects.forEach((effect) => effect());
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
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); render(); }
function recognized(text: string) { api.callbacks.onRecognized(text, []); render(); }
async function autoAnswer(text: string) {
  recognized(text);
  await vi.advanceTimersByTimeAsync(400);
  await flush();
  await vi.advanceTimersByTimeAsync(1500);
  await flush();
}
function typeQuestion() { props('AnswerPanel').onManualDraft('Why?'); render(); props('AnswerPanel').onManualSubmit(); }

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); slots = [];
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  api.detect.mockResolvedValue({ shouldAnswer: true, question: 'Why?', segmentIndex: 0, detector: 'jev', probabilities: {} });
  api.answer.mockImplementation(async (_body, event) => {
    event('question', { question: 'Why?' }); event('token', { text: 'Because.' }); event('done', {});
  });
  render();
});
afterEach(() => {
  for (const slot of slots) slot?.cleanup?.();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it.each(['error', 'incomplete', 'throw'])('does not save a partial %s answer to history', async (failure) => {
  api.answer.mockImplementation(async (_body, event) => {
    event('token', { text: 'Partial answer' });
    if (failure === 'error') { event('error', { error: 'Overloaded' }); event('done', {}); }
    if (failure === 'throw') throw new Error('Disconnected');
  });
  typeQuestion();
  await flush();
  expect(props('AnswerPanel').history).toEqual([]);
});

it('saves a completed answer to history', async () => {
  typeQuestion(); await flush();
  expect(props('AnswerPanel').history).toHaveLength(1);
});

it('fires the gate for segment 0 after Clear resets the answered range', async () => {
  await props('Header').onToggleRecording(); render();
  await autoAnswer('First question?');
  expect(api.answer).toHaveBeenCalledTimes(1);
  props('Header').onClearHistory(); render();
  await autoAnswer('New segment zero?');
  expect(api.answer).toHaveBeenCalledTimes(2);
});

it('ignores a question-start request that resolves after Clear', async () => {
  let resolve!: (result: any) => void;
  api.detect.mockReturnValue(new Promise((r) => { resolve = r; }));
  recognized('Old question?');
  props('AnswerPanel').onAnswerNow();
  props('Header').onClearHistory(); render();
  resolve({ segmentIndex: 0, detector: 'jev' }); await flush();
  expect(api.answer).not.toHaveBeenCalled();
});

it('ignores an auto detector result that resolves after Clear', async () => {
  let resolve!: (result: any) => void;
  api.detect.mockReturnValue(new Promise((r) => { resolve = r; }));
  await props('Header').onToggleRecording(); render();
  recognized('Old question?');
  await vi.advanceTimersByTimeAsync(400);
  props('Header').onClearHistory(); render();
  resolve({ shouldAnswer: true, question: 'Old?', detector: 'jev', probabilities: {} }); await flush();
  expect(props('AnswerPanel').detectorNote).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});
