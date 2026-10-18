import React from '../client/node_modules/react';
import App from '../client/src/App';
import { SettingsService } from '../client/src/services/settings';
import { afterEach, expect, it, vi } from 'vitest';

const speech = vi.hoisted(() => ({ callbacks: null as any }));
vi.mock('../client/src/services/api', () => ({ fetchPublicConfig: async () => ({}), detectQuestion: vi.fn(), streamAnswer: vi.fn() }));
vi.mock('../client/src/services/speechController', () => ({ SpeechController: class {
  constructor(callbacks: any) { speech.callbacks = callbacks; }
  async start() {}
  async stop() {}
} }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([false, true])('does not save an utterance that spans a consent change, starting enabled=%s', async (initialChoice) => {
  vi.useFakeTimers();
  (SettingsService as any).instance = undefined;
  const store = new Map([['user_settings', JSON.stringify({ saveTranscriptHistory: initialChoice })]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  const slots: any[] = [];
  let cursor = 0;
  let tree: any;
  const internals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  function memo(factory: () => any, deps: any[]) {
    const id = cursor++;
    if (!slots[id] || deps.some((dep, i) => dep !== slots[id].deps[i])) slots[id] = { value: factory(), deps };
    return slots[id].value;
  }
  function render() {
    cursor = 0;
    internals.ReactCurrentDispatcher.current = {
      useState(initial: any) {
        const id = cursor++;
        if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial;
        return [slots[id], (next: any) => { slots[id] = typeof next === 'function' ? next(slots[id]) : next; }];
      },
      useRef(initial: any) { const id = cursor++; return slots[id] ??= { current: initial }; },
      useMemo: memo, useCallback: (fn: any, deps: any[]) => memo(() => fn, deps), useEffect() {},
    };
    try { tree = App({}); } finally { internals.ReactCurrentDispatcher.current = null; }
  }
  function find(name: string, node = tree): any {
    if (!node || typeof node !== 'object') return;
    if (node.type?.name === name) return node.props;
    for (const child of [node.props?.children].flat(Infinity)) {
      if (child == null) continue;
      const found = find(name, child);
      if (found) return found;
    }
  }
  async function toggle() {
    const pending = find('Header').onToggleRecording();
    await vi.advanceTimersByTimeAsync(150); await pending; render();
  }
  function choose(enabled: boolean) {
    find('Header').onOpenSettings(); render();
    find('Settings').onUpdate({ ...find('Settings').initialSettings, saveTranscriptHistory: enabled }); render();
  }
  render(); await toggle();
  speech.callbacks.onRecognizing('Beginning before the new choice.', []); render();
  if (initialChoice) choose(false);
  choose(true);
  speech.callbacks.onRecognized('Final text includes the earlier unconsented portion.', []); render();
  await toggle();
  expect(store.has('transcriptionHistory'), 'An utterance spanning a consent change must not be queued').toBe(false);
  await toggle();
  speech.callbacks.onRecognizing('Fresh after choice.', []); render();
  speech.callbacks.onRecognized('Fresh after choice.', []); render(); await toggle();
  const history = JSON.parse(store.get('transcriptionHistory')!);
  expect(history[0].transcriptions.map((entry: any) => entry.originalText)).toEqual(['Fresh after choice.']);
});
