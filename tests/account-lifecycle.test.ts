import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import App from '../client/src/App';
import type { AnswerRequest } from '../client/src/services/api';
import { deferred, findProps, flush, hookHarness } from './account-harness';

type Callbacks = { onRecognized(text: string, translations: string[]): void; onRecognizing(text: string, translations: string[]): void };
type Event = (event: string, data: Record<string, unknown>) => void;
const network = vi.hoisted(() => ({
  callbacks: null as Callbacks | null,
  stop: vi.fn(async () => undefined),
  answer: vi.fn(async (_body: AnswerRequest, _event: Event, _signal?: AbortSignal): Promise<void> => undefined),
}));
vi.mock('../client/src/services/api', () => ({
  streamAnswer: network.answer, detectQuestion: async () => ({ shouldAnswer: false }), fetchPublicConfig: async () => ({}),
}));
vi.mock('../client/src/services/speechController', () => ({
  SpeechController: class {
    constructor(callbacks: Callbacks) { network.callbacks = callbacks; }
    async start() {}
    stop = network.stop;
  },
}));
function lifetime() {
  let active = true;
  const controller = new AbortController();
  const callbacks = new Set<() => void>();
  const storage = {
    get active() { return active; }, key: (key: string) => `captured-A:${key}`,
    getItem: (key: string) => active ? localStorage.getItem(`captured-A:${key}`) : null,
    setItem: (key: string, value: string) => { if (!active) return false; localStorage.setItem(`captured-A:${key}`, value); return true; },
    revoke() { active = false; }, clearConfirmedAccountCache() { return false; },
  };
  const revoke = () => { if (!active) return; active = false; controller.abort(); for (const callback of callbacks) callback(); };
  return {
    storage, signal: controller.signal, get active() { return active; }, revoke, invalidate: revoke,
    onRevoke(fn: () => void) { callbacks.add(fn); return () => { callbacks.delete(fn); }; },
  };
}
type Runtime = ReturnType<typeof lifetime>;
type Header = { onToggleRecording(): Promise<void> };
type Panel = { onManualDraft(value: string): void; onManualSubmit(): void; answer: string };
let run: ReturnType<typeof hookHarness<{ runtime: Runtime }>>;
let runtime: Runtime;
let stored: Map<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  stored = new Map([
    ['user_settings', JSON.stringify({ saveTranscriptHistory: true })],
    ['captured-A:user_settings', JSON.stringify({ saveTranscriptHistory: true })],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  runtime = lifetime();
  // Old App accepts no runtime and ignores this captured lifetime: the resulting
  // retained callbacks reproduce the real unsafe behaviour before the fix.
  run = hookHarness(App as unknown as (props: { runtime: Runtime }) => ReactNode, { runtime });
  run.render();
});
afterEach(() => { run.unmount(); vi.unstubAllGlobals(); });

it('stops an active microphone synchronously on account invalidation before React unmount', async () => {
  await findProps<Header>(run.tree, 'Header')!.onToggleRecording(); run.render();
  const previousStops = network.stop.mock.calls.length;
  runtime.invalidate();
  expect(network.stop.mock.calls.length, 'account invalidation must stop speech before an async signout or unmount').toBeGreaterThan(previousStops);
  const before = new Map(stored);
  network.callbacks!.onRecognized('Late account A result', []); run.render();
  expect(stored, 'late recognition must not persist any account or owner history').toEqual(before);
});

it('aborts streaming answers on invalidation and rejects retained provider events', async () => {
  const pending = deferred<void>(); let emit!: Event; let signal: AbortSignal | undefined;
  network.answer.mockImplementation((_body, callback, abort) => { emit = callback; signal = abort; return pending.promise; });
  findProps<Panel>(run.tree, 'AnswerPanel')!.onManualDraft('Private question'); run.render();
  findProps<Panel>(run.tree, 'AnswerPanel')!.onManualSubmit(); await flush();
  expect(signal?.aborted).toBe(false);
  runtime.invalidate();
  expect(signal?.aborted, 'account revocation must abort the current answer before unmount').toBe(true);
  emit('token', { text: 'Late answer' }); emit('done', {}); pending.resolve(); await flush(); run.render();
  expect(findProps<Panel>(run.tree, 'AnswerPanel')!.answer).toBe('');
});

it('retained settings callbacks cannot save personal context after account revocation', () => {
  const header = findProps<{ onOpenSettings(): void }>(run.tree, 'Header')!;
  header.onOpenSettings(); run.render();
  const settings = findProps<{ initialSettings: Record<string, unknown>; onUpdate(next: Record<string, unknown>): void }>(run.tree, 'Settings')!;
  runtime.invalidate(); const before = new Map(stored);
  settings.onUpdate({ ...settings.initialSettings, userContext: 'Too late' });
  expect(stored, 'revoked Settings callbacks must not write another lifetime or legacy data').toEqual(before);
});
