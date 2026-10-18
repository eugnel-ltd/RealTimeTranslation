import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAnswer } from '../worker/src/answer';
import { attachGeminiProxy, type WsPeer } from '../worker/src/gemini';
import { streamAnswer, type AnswerRequest } from '../client/src/services/api';
import { mockEnv, mockFetch } from './helpers';

afterEach(() => vi.restoreAllMocks());
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const answerBody = { conversation: 'Why?', extractQuestion: true, force: true };
const browserBody: AnswerRequest = { conversation: 'Why?', answerLanguage: 'en', userContext: '', model: 'gemini-3.8-flash' };
function post(signal?: AbortSignal) {
  return new Request('https://rtt.eugnel.com/api/answer', { method: 'POST', body: JSON.stringify(answerBody), signal });
}

describe('answer cancellation', () => {
  it.each(['response cancel', 'request abort'])('stops an idle upstream on %s', async (mode) => {
    const cancel = vi.fn();
    const upstream = new ReadableStream<Uint8Array>({ cancel });
    const abort = new AbortController();
    let providerSignal: AbortSignal | null | undefined;
    const response = await handleAnswer(post(abort.signal), mockEnv({ GEMINI_API_KEY: 'test-key' }), mockFetch((_url, init) => {
      providerSignal = init?.signal;
      return new Response(upstream);
    }));
    if (mode === 'response cancel') await response.body!.cancel();
    else abort.abort();
    await flush();
    expect(providerSignal, 'provider fetch must have a cancellation signal').toBeDefined();
    expect(providerSignal?.aborted).toBe(true);
    expect(cancel, 'idle upstream reader must cancel immediately').toHaveBeenCalledOnce();
    expect(upstream.locked).toBe(false);
  });

  it('does not start provider work when the request was already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const provider = vi.fn(async () => new Response('data: {"candidates":[{"finishReason":"STOP"}]}\n\n'));
    const response = await handleAnswer(post(abort.signal), mockEnv({ GEMINI_API_KEY: 'test-key' }), provider as typeof fetch).catch(() => undefined);
    if (response) await response.text();
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('browser answer SSE', () => {
  it('reads split CRLF frames and a final unterminated UTF-8 event', async () => {
    const bytes = new TextEncoder().encode('event: question\r\ndata: {"question":"Why?"}\r\n\r\nevent: token\r\ndata: {"text":"粵語"}');
    let cursor = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (cursor === bytes.length) controller.close();
        else controller.enqueue(bytes.slice(cursor, ++cursor));
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
    const events: unknown[] = [];
    await streamAnswer(browserBody, (event, data) => events.push([event, data]));
    expect(events).toEqual([['question', { question: 'Why?' }], ['token', { text: '粵語' }]]);
    expect(body.locked).toBe(false);
  });

  it('cancels and releases an idle reader immediately on abort', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
    const abort = new AbortController();
    let settled = false;
    const task = streamAnswer(browserBody, vi.fn(), abort.signal).then(() => { settled = true; }, () => { settled = true; });
    await flush();
    abort.abort();
    await flush();
    expect(cancel).toHaveBeenCalledOnce();
    expect(settled).toBe(true);
    expect(body.locked).toBe(false);
    if (settled) await task;
  });

  it('cancels and releases the reader if an event callback throws', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('event: token\ndata: {"text":"hello"}\n\n')); }, cancel,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
    await expect(streamAnswer(browserBody, () => { throw new Error('callback failed'); })).rejects.toThrow('callback failed');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
});

class Peer implements WsPeer {
  sent: string[] = [];
  listeners = new Map<string, Array<(event: Event) => void>>();
  send(data: string) { this.sent.push(data); }
  close() { this.emit('close', {}); }
  addEventListener(type: string, listener: (event: Event) => void) { this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]); }
  emit(type: string, data: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(data as Event); }
}

it.each(['local', 'remote'])('keeps delayed WebSocket frames ordered from %s', async (direction) => {
  const local = new Peer();
  const remote = new Peer();
  attachGeminiProxy(local, remote);
  const [source, destination] = direction === 'local' ? [local, remote] : [remote, local];
  let resolve!: (value: string) => void;
  const pending = new Promise<string>((done) => { resolve = done; });
  source.emit('message', { data: { text: () => pending } });
  source.emit('message', { data: 'second' });
  await flush();
  resolve('first');
  await flush();
  expect(destination.sent).toEqual(['first', 'second']);
});

it('discards queued WebSocket frames after close', async () => {
  const local = new Peer();
  const remote = new Peer();
  attachGeminiProxy(local, remote);
  let resolve!: (value: string) => void;
  const pending = new Promise<string>((done) => { resolve = done; });
  local.emit('message', { data: { text: () => pending } });
  await flush();
  local.emit('close', {});
  resolve('too late');
  await flush();
  expect(remote.sent).toEqual([]);
});
