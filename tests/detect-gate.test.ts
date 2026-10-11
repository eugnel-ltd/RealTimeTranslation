import { describe, expect, it } from 'vitest';
import { confirmSilence, createDetectGateState, nextDetectGate } from '../client/src/detectors/detectGate';
import { SILENCE_CONFIRM_MS } from '../shared/extractWindow';

const fp = 'i:3';

describe('detectGate', () => {
  it('does not fire on the first positive; arms ~1s silence', () => {
    const first = nextDetectGate(createDetectGateState(), {
      positive: true,
      fingerprint: fp,
      nowMs: 1000,
      finalCount: 4,
      lastAnswered: null,
    });
    expect(first.fire).toBe(false);
    expect(first.scheduleSilenceMs).toBe(SILENCE_CONFIRM_MS);
    expect(first.state.hits).toBe(1);
  });

  it('fires on two consecutive positives when new finals arrive', () => {
    const first = nextDetectGate(createDetectGateState(), {
      positive: true,
      fingerprint: fp,
      nowMs: 1000,
      finalCount: 4,
      lastAnswered: null,
    });
    const second = nextDetectGate(first.state, {
      positive: true,
      fingerprint: fp,
      nowMs: 1400,
      finalCount: 5,
      lastAnswered: null,
    });
    expect(second.fire).toBe(true);
    expect(second.scheduleSilenceMs).toBeNull();
    expect(second.state.firedFingerprint).toBe(fp);
    expect(second.state.hits).toBe(0);
  });

  it('does not count a second poll of the same finals as consecutive', () => {
    const first = nextDetectGate(createDetectGateState(), {
      positive: true,
      fingerprint: fp,
      nowMs: 1000,
      finalCount: 4,
      lastAnswered: null,
    });
    const echo = nextDetectGate(first.state, {
      positive: true,
      fingerprint: fp,
      nowMs: 1400,
      finalCount: 4,
      lastAnswered: null,
    });
    expect(echo.fire).toBe(false);
    expect(echo.scheduleSilenceMs).toBeNull();
    expect(echo.state.hits).toBe(1);
  });

  it('fires after one positive plus ~1s of silence (no new finals)', () => {
    const first = nextDetectGate(createDetectGateState(), {
      positive: true,
      fingerprint: fp,
      nowMs: 1000,
      finalCount: 4,
      lastAnswered: null,
    });
    const silent = confirmSilence(first.state, { nowMs: 1000 + SILENCE_CONFIRM_MS, finalCount: 4, lastAnswered: null });
    expect(silent.fire).toBe(true);
    expect(silent.state.firedFingerprint).toBe(fp);
  });

  it('does not fire silence confirm if new speech arrived', () => {
    const first = nextDetectGate(createDetectGateState(), {
      positive: true,
      fingerprint: fp,
      nowMs: 1000,
      finalCount: 4,
      lastAnswered: null,
    });
    const silent = confirmSilence(first.state, { nowMs: 2200, finalCount: 5, lastAnswered: null });
    expect(silent.fire).toBe(false);
  });

  it('does not re-trigger the same question after firing', () => {
    const first = nextDetectGate(createDetectGateState(), {
      positive: true,
      fingerprint: fp,
      nowMs: 1000,
      finalCount: 4,
      lastAnswered: null,
    });
    const fired = nextDetectGate(first.state, {
      positive: true,
      fingerprint: fp,
      nowMs: 1400,
      finalCount: 5,
      lastAnswered: null,
    });
    expect(fired.fire).toBe(true);
    const again = nextDetectGate(fired.state, {
      positive: true,
      fingerprint: fp,
      nowMs: 2000,
      finalCount: 6,
      lastAnswered: 'Tell me about a production incident you owned.',
    });
    expect(again.fire).toBe(false);
    expect(again.state.hits).toBe(0);
  });

  it('resets hits on a negative so a later single positive is not a second hit', () => {
    const first = nextDetectGate(createDetectGateState(), {
      positive: true,
      fingerprint: fp,
      nowMs: 1000,
      finalCount: 4,
      lastAnswered: null,
    });
    const neg = nextDetectGate(first.state, {
      positive: false,
      fingerprint: fp,
      nowMs: 1300,
      finalCount: 5,
      lastAnswered: null,
    });
    expect(neg.state.hits).toBe(0);
    const later = nextDetectGate(neg.state, {
      positive: true,
      fingerprint: fp,
      nowMs: 1600,
      finalCount: 6,
      lastAnswered: null,
    });
    expect(later.fire).toBe(false);
    expect(later.state.hits).toBe(1);
  });
});
