import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React from '../client/node_modules/react';
import App from '../client/src/App';
import { SettingsService } from '../client/src/services/settings';
import type { AnswerRequest, DetectQuestionPayload, DetectQuestionResult } from '../client/src/services/api';

type AnswerEvent = (event: string, data: Record<string, unknown>) => void;
type SpeechCallbacks = {
  onRecognizing(original: string, translations: string[]): void;
  onRecognized(original: string, translations: string[]): void;
};
const api = vi.hoisted(() => ({
  answer: vi.fn(async (_body: AnswerRequest, _event: AnswerEvent, _signal?: AbortSignal): Promise<void> => undefined),
  detect: vi.fn(async (_body: DetectQuestionPayload): Promise<DetectQuestionResult> => ({
    shouldAnswer: true, question: 'Why?', segmentIndex: 0, detector: 'jev',
    probabilities: { newQuestionFromOtherParty: 1, isInterviewQuestion: 1 },
  })),
  callbacks: null as SpeechCallbacks | null,
}));
vi.mock('../client/src/services/api', () => ({
  streamAnswer: api.answer, detectQuestion: api.detect, fetchPublicConfig: async () => ({}),
}));
vi.mock('../client/src/services/speechController', () => ({
  SpeechController: class {
    constructor(callbacks: SpeechCallbacks) { api.callbacks = callbacks; }
    async start(_config: unknown, _mode: unknown) {}
    async stop() {}
  },
}));

// Exercise the real App hooks and cleanup, retaining callbacks across unmount.
let slots: any[];
let cursor: number;
let effects: Array<() => void>;
let tree: any;
let mounted: boolean;
let lateStateWrites: number;
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
      if (!mounted) lateStateWrites++;
      slots[id] = typeof next === 'function' ? next(slots[id]) : next;
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
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function unmount() {
  if (!mounted) return;
  mounted = false;
  for (const slot of slots) slot?.cleanup?.();
}
async function recordQuestion() {
  await props('Header').onToggleRecording(); render();
  api.callbacks!.onRecognized('Why?', []); render();
  await flush();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const detected: DetectQuestionResult = {
  shouldAnswer: true, question: 'Why?', segmentIndex: 0, detector: 'jev',
  probabilities: { newQuestionFromOtherParty: 1, isInterviewQuestion: 1 },
};

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); slots = []; mounted = true; lateStateWrites = 0;
  (SettingsService as any).instance = undefined;
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  api.detect.mockResolvedValue(detected);
  api.answer.mockResolvedValue(undefined);
  render();
});
afterEach(() => { unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('cancels a pending detector debounce before unmount can start provider work', async () => {
  await recordQuestion();
  expect(api.detect).not.toHaveBeenCalled();
  unmount();
  await vi.advanceTimersByTimeAsync(400); await flush();
  expect(api.detect, 'unmounted App must not start its debounced detector').not.toHaveBeenCalled();
  expect(api.answer).not.toHaveBeenCalled();
  expect(lateStateWrites).toBe(0);
});

it('ignores a manual extraction resolving after unmount without starting an answer', async () => {
  const pending = deferred<DetectQuestionResult>();
  api.detect.mockReturnValue(pending.promise);
  await recordQuestion();
  props('AnswerPanel').onAnswerNow();
  expect(api.detect).toHaveBeenCalledTimes(1);
  unmount();
  pending.resolve(detected); await flush();
  expect(api.answer, 'late question-start results must not start an answer after unmount').not.toHaveBeenCalled();
  expect(lateStateWrites).toBe(0);
});

it('ignores an auto detector already in flight when App unmounts', async () => {
  const pending = deferred<DetectQuestionResult>();
  api.detect.mockReturnValue(pending.promise);
  await recordQuestion(); await vi.advanceTimersByTimeAsync(400);
  expect(api.detect).toHaveBeenCalledTimes(1);
  unmount();
  pending.resolve(detected); await flush();
  expect(lateStateWrites, 'late auto detector must not update an unmounted App').toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(api.answer).not.toHaveBeenCalled();
});

it('clears a scheduled silence confirmation before it can start extraction after unmount', async () => {
  await recordQuestion(); await vi.advanceTimersByTimeAsync(400); await flush();
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount(), 'unmount must release the pending silence timer').toBe(0);
  await vi.advanceTimersByTimeAsync(2000); await flush();
  expect(api.detect).toHaveBeenCalledTimes(1);
  expect(api.answer).not.toHaveBeenCalled();
  expect(lateStateWrites).toBe(0);
});

it.each(['completion', 'rejection'])('aborts an active answer and ignores late stream %s after unmount', async (outcome) => {
  const pending = deferred<void>();
  let emit!: AnswerEvent;
  let signal: AbortSignal | undefined;
  api.answer.mockImplementation((_body, onEvent, abort) => {
    emit = onEvent; signal = abort; return pending.promise;
  });
  props('AnswerPanel').onManualDraft('Why?'); render();
  props('AnswerPanel').onManualSubmit(); await flush();
  expect(signal?.aborted).toBe(false);
  unmount();
  expect(signal?.aborted, 'unmount must abort its active provider answer').toBe(true);
  emit('question', { question: 'Too late?' });
  emit('token', { text: 'Too late.' });
  emit('error', { error: 'Too late.' });
  emit('done', {});
  if (outcome === 'completion') pending.resolve();
  else pending.reject(new Error('late reader failure'));
  await flush();
  expect(lateStateWrites, 'stream callbacks and finally must not update state after unmount').toBe(0);
  expect(api.answer).toHaveBeenCalledTimes(1);
});
