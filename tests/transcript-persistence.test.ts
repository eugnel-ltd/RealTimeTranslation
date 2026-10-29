import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React from '../client/node_modules/react';
import App from '../client/src/App';
import History from '../client/src/components/History';
import { SettingsService } from '../client/src/services/settings';

const speech = vi.hoisted(() => ({
  instances: [] as any[],
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('../client/src/services/api', () => ({
  streamAnswer: vi.fn(),
  detectQuestion: vi.fn(async () => ({ shouldAnswer: false })),
  fetchPublicConfig: async () => ({}),
}));
vi.mock('../client/src/services/speechController', () => ({
  SpeechController: class {
    callbacks: any;
    start = speech.start;
    stop = speech.stop;
    constructor(callbacks: any) { this.callbacks = callbacks; speech.instances.push(this); }
  },
}));

// Execute the real component's hooks, handlers and effects without a browser DOM.
// Components below App remain React elements so assertions can inspect their public props.
let slots: any[];
let cursor: number;
let effects: Array<() => void>;
let tree: any;
let dirty: boolean;
let component: any;
let store: Map<string, string>;
let storage: any;
let failWrites: number;
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
    try { tree = component({}); } finally { internals.ReactCurrentDispatcher.current = null; }
    effects.forEach((effect) => effect());
    if (!dirty) return;
  }
  throw new Error('Component failed to settle after 20 renders');
}
function find(predicate: (node: any) => boolean, node = tree): any {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    if (child == null) continue;
    const found = find(predicate, child);
    if (found) return found;
  }
}
function props(name: string) { return find((node) => node.type?.name === name)?.props; }
function callbacks() { return speech.instances.at(-1).callbacks; }
function finals() { return props('TranscriptBox').transcripts.filter((entry: any) => entry.isFinal); }
function history() { return JSON.parse(store.get('transcriptionHistory') || '[]'); }
function emit(text: string, final = true) {
  callbacks()[final ? 'onRecognized' : 'onRecognizing'](text, ['translated'], 'en-US');
  render();
}
async function toggle() {
  const promise = props('Header').onToggleRecording();
  promise.catch(() => undefined);
  await vi.advanceTimersByTimeAsync(150);
  await promise;
  render();
}
function historyWrites() {
  return storage.setItem.mock.calls.filter(([key]: [string]) => key === 'transcriptionHistory');
}
function historyReads() {
  return storage.getItem.mock.calls.filter(([key]: [string]) => key === 'transcriptionHistory');
}

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); speech.instances = [];
  speech.start.mockResolvedValue(undefined); speech.stop.mockResolvedValue(undefined);
  slots = []; component = App; failWrites = 0;
  (SettingsService as any).instance = undefined;
  // These existing regressions exercise the explicitly requested saved-history feature.
  store = new Map([['user_settings', JSON.stringify({ saveTranscriptHistory: true })]]);
  storage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      if (key === 'transcriptionHistory' && failWrites-- > 0) throw new Error('Storage full');
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => store.delete(key)),
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  render();
});
afterEach(() => {
  for (const slot of slots) slot?.cleanup?.();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it('retains identical final utterances as separate records within one session', async () => {
  await toggle(); emit('Yes.'); emit('Yes.');
  expect(finals().map((entry: any) => entry.original)).toEqual(['Yes.', 'Yes.']);
  expect(history()[0].transcriptions).toHaveLength(2);
  expect(new Set(history()[0].transcriptions.map((entry: any) => entry.id)).size).toBe(2);
});

it('keeps one stable utterance identity from interim through final', async () => {
  await toggle(); emit('Hel', false);
  const interim = props('TranscriptBox').transcripts[0];
  expect(interim.id).toEqual(expect.any(String));
  emit('Hello.');
  expect(finals()).toHaveLength(1);
  expect(finals()[0].id).toBe(interim.id);
  expect(history()[0].transcriptions[0].id).toBe(interim.id);
});

it('preserves repeated text across sessions without moving earlier utterances into the next session', async () => {
  await toggle(); emit('Same words.'); emit('Only in first.');
  await toggle(); await vi.advanceTimersByTimeAsync(1);
  await toggle(); emit('Same words.');
  expect(history()).toHaveLength(2);
  expect(history()[0].transcriptions.map((entry: any) => entry.originalText)).toEqual(['Same words.']);
  expect(history()[1].transcriptions.map((entry: any) => entry.originalText)).toEqual(['Same words.', 'Only in first.']);
  expect(finals()[0].sessionId).not.toBe(finals().at(-1).sessionId);
});

it('marks successful finals saved and avoids reading or writing history on later interims', async () => {
  await toggle(); emit('Persist once.');
  expect(finals()[0].isSaved).toBe(true);
  storage.getItem.mockClear(); storage.setItem.mockClear();
  emit('Next', false); emit('Next words', false);
  expect(historyReads()).toHaveLength(0);
  expect(historyWrites()).toHaveLength(0);
});

it('retries a failed history write without losing or duplicating the final utterance', async () => {
  await toggle(); failWrites = 1;
  expect(() => emit('Retry this.')).not.toThrow();
  expect(finals()[0].isSaved).not.toBe(true);
  emit('Interim retry', false);
  expect(history()[0].transcriptions.map((entry: any) => entry.originalText)).toEqual(['Retry this.']);
  expect(finals()[0].isSaved).toBe(true);
  emit('Another interim', false);
  expect(history()[0].transcriptions).toHaveLength(1);
});

it.each(['{', 'null', '{}', '[null,{"sessionId":5,"transcriptions":false}]'])(
  'records safely when saved history contains %s', async (raw) => {
    await toggle(); store.set('transcriptionHistory', raw);
    expect(() => emit('Recover history.')).not.toThrow();
    expect(history()[0].transcriptions[0].originalText).toBe('Recover history.');
  },
);

it('continues recording and updating transcripts when browser storage is blocked', async () => {
  storage.getItem.mockImplementation(() => { throw new Error('Storage blocked'); });
  storage.setItem.mockImplementation(() => { throw new Error('Storage blocked'); });
  storage.removeItem.mockImplementation(() => { throw new Error('Storage blocked'); });
  await toggle();
  expect(props('Header').isRecording).toBe(true);
  expect(() => emit('In memory.')).not.toThrow();
  expect(finals()[0].original).toBe('In memory.');
  await toggle();
  expect(props('Header').isRecording).toBe(false);
});

it('a second toggle cancels pending startup and a late start cannot reactivate recording', async () => {
  let resolve!: () => void;
  speech.start.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
  const starting = props('Header').onToggleRecording(); render();
  const stopping = props('Header').onToggleRecording(); render();
  resolve();
  await vi.advanceTimersByTimeAsync(150);
  await Promise.all([starting, stopping]); render();
  expect(speech.stop).toHaveBeenCalled();
  expect(props('Header').isRecording).toBe(false);
});

it('ignores callbacks and errors from a stopped recording after a new session starts', async () => {
  await toggle(); const old = callbacks(); emit('First.');
  await toggle(); await toggle();
  old.onRecognized('Stale final.', []);
  old.onRecognizing('Stale interim.', []);
  old.onError('Stale failure');
  old.onNotice('Stale notice');
  render();
  expect(props('Header').isRecording).toBe(true);
  expect(props('TranscriptBox').transcripts.map((entry: any) => entry.original)).toEqual(['First.']);
  expect(JSON.stringify(tree)).not.toContain('Stale');
});

it('cancels pending startup when language settings change and ignores its late callbacks', async () => {
  let resolve!: () => void;
  speech.start.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
  const starting = props('Header').onToggleRecording(); render();
  const old = callbacks();
  props('Header').onOpenSettings(); render();
  props('Settings').onUpdate({ ...props('Settings').initialSettings, outputLanguage: 'fr-FR' }); render();
  old.onRecognized('Wrong language session.', []);
  resolve();
  await vi.advanceTimersByTimeAsync(150); await starting; render();
  expect(speech.stop).toHaveBeenCalled();
  expect(props('Header').isRecording).toBe(false);
  expect(finals()).toHaveLength(0);
});

it.each(['{', 'null', '{}', '[null,{"sessionId":"bad","timestamp":"bad","transcriptions":null}]'])(
  'History renders safely with malformed storage %s', (raw) => {
    slots = []; component = History; store.set('transcriptionHistory', raw);
    expect(render).not.toThrow();
    expect(JSON.stringify(tree)).toContain('No recording history available');
  },
);

it('History renders and deletes safely if storage access becomes blocked', () => {
  store.set('transcriptionHistory', JSON.stringify([{
    sessionId: 'history-session', timestamp: new Date().toISOString(),
    transcriptions: [{ id: 'entry', timestamp: new Date().toISOString(), originalText: 'Old',
      translatedTexts: [], sourceLanguage: 'en-US', targetLanguages: [] }],
  }]));
  slots = []; component = History; render();
  find((node) => node.props?.title === 'Delete recording').props.onClick({ stopPropagation() {} }); render();
  storage.getItem.mockImplementation(() => { throw new Error('Storage blocked'); });
  storage.setItem.mockImplementation(() => { throw new Error('Storage blocked'); });
  expect(() => props('ConfirmDialog').onConfirm()).not.toThrow();
  render();
  expect(JSON.stringify(tree)).toContain('1');
});

function chooseHistory(enabled: boolean) {
  props('Header').onOpenSettings(); render();
  props('Settings').onUpdate({ ...props('Settings').initialSettings, saveTranscriptHistory: enabled }); render();
}

it('does not save new transcripts without a positive history choice and preserves existing storage', async () => {
  const oldHistory = JSON.stringify([{ sessionId: 'old-session', timestamp: '2026-10-17T00:00:00Z', transcriptions: [] }]);
  const oldSettings = JSON.stringify({ userContext: 'Keep context', extraNotes: 'Keep notes' });
  store.set('transcriptionHistory', oldHistory); store.set('user_settings', oldSettings);
  (SettingsService as any).instance = undefined; slots = []; render();
  await toggle(); emit('Not requested for storage.'); await toggle();
  expect(finals()[0].original).toBe('Not requested for storage.');
  expect(historyWrites()).toHaveLength(0);
  expect(store.get('transcriptionHistory')).toBe(oldHistory);
  expect(store.get('user_settings')).toBe(oldSettings);
});

it('saves only future final transcripts after explicit opt-in, never retroactive text', async () => {
  chooseHistory(false); await toggle(); emit('Before choice.');
  chooseHistory(true); emit('After choice.'); await toggle();
  expect(history()[0].transcriptions.map((entry: any) => entry.originalText)).toEqual(['After choice.']);
  expect(finals().map((entry: any) => entry.original)).toEqual(['Before choice.', 'After choice.']);
});

it('withdrawal immediately blocks a running session and drops retries without deleting saved history', async () => {
  await toggle(); emit('Saved before withdrawal.');
  failWrites = 1; emit('Failed pending write.');
  const saved = store.get('transcriptionHistory');
  chooseHistory(false);
  const writes = historyWrites().length;
  emit('While off.'); await toggle();
  expect(historyWrites()).toHaveLength(writes);
  expect(store.get('transcriptionHistory')).toBe(saved);
  chooseHistory(true); await toggle(); emit('New request.'); await toggle();
  expect(history().flatMap((session: any) => session.transcriptions.map((entry: any) => entry.originalText)))
    .toEqual(['New request.', 'Saved before withdrawal.']);
  expect(finals().map((entry: any) => entry.original)).toContain('Failed pending write.');
});

it('opted-in Clear Transcripts flushes pending finals and keeps durable history', async () => {
  await toggle(); failWrites = 1; emit('Flush on clear.');
  expect(finals()[0].isSaved).not.toBe(true);
  props('Header').onClearHistory(); render();
  expect(finals()).toHaveLength(0);
  expect(history()[0].transcriptions[0].originalText).toBe('Flush on clear.');
});

it('provides a minimal app footer linking to the Company information page and its policy destinations', () => {
  const footerComponent = find((node) => node.type?.name === 'LegalFooter');
  expect(footerComponent, 'Missing minimal app footer linking to Company information').toBeDefined();
  const footer = footerComponent.type(footerComponent.props);
  expect(footer.type).toBe('footer');
  const companyLink = find((node) => node.type === 'a' && node.props.href === '/company/', footer);
  expect(companyLink, 'Missing app link to Company information page and its policy destinations').toBeDefined();
  expect(companyLink.props.children).toBe('Company information');
});
