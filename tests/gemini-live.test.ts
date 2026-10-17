import { describe, expect, it } from 'vitest';
import { attachGeminiProxy, forwardCloseCode, wsDataToText, type WsPeer } from '../worker/src/gemini';

class MockWs implements WsPeer {
  sent: string[] = [];
  closed?: { code: number; reason: string };
  private listeners = new Map<string, Array<(event: Event) => void>>();

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = '') {
    this.closed = { code, reason };
    this.emit('close', { code, reason } as CloseEvent);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  emitMessage(data: unknown) {
    this.emit('message', { data } as MessageEvent);
  }
}

async function waitForSent(peer: MockWs, expected: string) {
  const start = Date.now();
  while (Date.now() - start < 1000) {
    if (peer.sent[0] === expected) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`expected ${expected}, got ${JSON.stringify(peer.sent)}`);
}

describe('gemini live proxy', () => {
  it('decodes Gemini binary JSON instead of "[object Blob]"', async () => {
    const payload = '{"setupComplete":{}}';
    expect(String(new Blob([payload]))).toBe('[object Blob]');
    expect(await wsDataToText(new Blob([payload]))).toBe(payload);
    expect(await wsDataToText(new TextEncoder().encode(payload))).toBe(payload);

    const local = new MockWs();
    const remote = new MockWs();
    attachGeminiProxy(local, remote);
    remote.emitMessage(new Blob([payload]));
    await waitForSent(local, payload);
    expect(local.sent[0]).not.toBe('[object Blob]');
  });

  it('forwards ArrayBuffer JSON as text', async () => {
    const payload = '{"setupComplete":{}}';
    const local = new MockWs();
    const remote = new MockWs();
    attachGeminiProxy(local, remote);
    remote.emitMessage(new TextEncoder().encode(payload).buffer);
    await waitForSent(local, payload);
  });

  it('propagates Gemini close code 1007 and reason both ways', () => {
    expect(forwardCloseCode(1007)).toBe(1007);
    expect(forwardCloseCode(1005)).toBe(1000);

    const local = new MockWs();
    const remote = new MockWs();
    attachGeminiProxy(local, remote);
    remote.emit('close', { code: 1007, reason: 'invalid payload' } as CloseEvent);
    expect(local.closed).toEqual({ code: 1007, reason: 'invalid payload' });

    const local2 = new MockWs();
    const remote2 = new MockWs();
    attachGeminiProxy(local2, remote2);
    local2.emit('close', { code: 1000, reason: 'client stop' } as CloseEvent);
    expect(remote2.closed).toEqual({ code: 1000, reason: 'client stop' });
  });
});
