import { describe, expect, it } from 'vitest';
import { confirmSilence, createDetectGateState, nextDetectGate } from '../client/src/detectors/detectGate';
import { SILENCE_CONFIRM_MS, TWO_HIT_WINDOW_MS } from '../shared/extractWindow';

const fp = 'a:12';

function hit(partial: Partial<Parameters<typeof nextDetectGate>[1]> & { nowMs: number; fingerprint?: string; finalCount?: number }) {
  return {
    positive: true,
    fingerprint: fp,
    newestId: 12,
    finalCount: 4,
    lastAnsweredEndId: null,
    ...partial,
  };
}

describe('detectGate', () => {
  it('does not fire on the first positive; arms ~1.5s silence', () => {
    const first = nextDetectGate(createDetectGateState(), hit({ nowMs: 1000 }));
    expect(first.fire).toBe(false);
    expect(first.scheduleSilenceMs).toBe(SILENCE_CONFIRM_MS);
    expect(first.state.hits).toBe(1);
  });

  it('fires on two positives within ~3s even without new finals', () => {
    const first = nextDetectGate(createDetectGateState(), hit({ nowMs: 1000, finalCount: 4 }));
    const second = nextDetectGate(first.state, hit({ nowMs: 1000 + TWO_HIT_WINDOW_MS - 100, finalCount: 4, fingerprint: 'a:12' }));
    expect(second.fire).toBe(true);
    expect(second.state.firedFingerprint).toBe('a:12');
  });

  it('fires after one positive plus ~1.5s even if later finals arrive (candidate answering)', () => {
    const first = nextDetectGate(createDetectGateState(), hit({ nowMs: 1000, finalCount: 4 }));
    const silent = confirmSilence(first.state, {
      nowMs: 1000 + SILENCE_CONFIRM_MS,
      newestId: 14,
      lastAnsweredEndId: null,
    });
    expect(silent.fire).toBe(true);
  });

  it('does not reset a pending hit on a negative (candidate talking)', () => {
    const first = nextDetectGate(createDetectGateState(), hit({ nowMs: 1000 }));
    const neg = nextDetectGate(first.state, {
      positive: false,
      fingerprint: 'a:13',
      newestId: 13,
      nowMs: 1300,
      finalCount: 5,
      lastAnsweredEndId: null,
    });
    expect(neg.state.hits).toBe(1);
    expect(neg.fire).toBe(false);
    const silent = confirmSilence(neg.state, { nowMs: 1000 + SILENCE_CONFIRM_MS, newestId: 13, lastAnsweredEndId: null });
    expect(silent.fire).toBe(true);
  });

  it('ignores positives whose newest id is still inside the last answered range', () => {
    const out = nextDetectGate(createDetectGateState(), hit({ nowMs: 1000, newestId: 6, lastAnsweredEndId: 8 }));
    expect(out.fire).toBe(false);
    expect(out.state.hits).toBe(0);
    expect(out.scheduleSilenceMs).toBeNull();
  });

  it('does not re-trigger the same fingerprint after firing', () => {
    const first = nextDetectGate(createDetectGateState(), hit({ nowMs: 1000 }));
    const fired = nextDetectGate(first.state, hit({ nowMs: 1400, fingerprint: fp }));
    expect(fired.fire).toBe(true);
    const again = nextDetectGate(fired.state, hit({ nowMs: 2000, fingerprint: fp, finalCount: 6 }));
    expect(again.fire).toBe(false);
  });
});
