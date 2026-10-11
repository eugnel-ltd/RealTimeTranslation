import { SILENCE_CONFIRM_MS } from '../../../shared/extractWindow';

export type DetectGateState = {
  hits: number;
  fingerprint: string | null;
  lastHitAtMs: number | null;
  lastFinalCount: number;
  firedFingerprint: string | null;
};

export type DetectGateEvent = {
  positive: boolean;
  fingerprint: string;
  nowMs: number;
  finalCount: number;
  lastAnswered: string | null;
};

export type DetectGateOutcome = {
  state: DetectGateState;
  fire: boolean;
  /** Arm a silence timer for this many ms. Null means keep or clear any existing timer. */
  scheduleSilenceMs: number | null;
};

export function createDetectGateState(): DetectGateState {
  return {
    hits: 0,
    fingerprint: null,
    lastHitAtMs: null,
    lastFinalCount: 0,
    firedFingerprint: null,
  };
}

function isRepeat(state: DetectGateState, fingerprint: string, lastAnswered: string | null): boolean {
  if (!fingerprint) return true;
  if (state.firedFingerprint != null && fingerprint === state.firedFingerprint) return true;
  if (lastAnswered && fingerprint === lastAnswered) return true;
  return false;
}

function resetHits(state: DetectGateState, finalCount: number): DetectGateState {
  return {
    ...state,
    hits: 0,
    fingerprint: null,
    lastHitAtMs: null,
    lastFinalCount: finalCount,
  };
}

function markFired(state: DetectGateState, fingerprint: string, finalCount: number): DetectGateState {
  return {
    ...state,
    hits: 0,
    fingerprint: null,
    lastHitAtMs: null,
    lastFinalCount: finalCount,
    firedFingerprint: fingerprint,
  };
}

/** Two consecutive positives (with new finals between) or one positive + ~1s silence. Never re-fires the same fingerprint. */
export function nextDetectGate(state: DetectGateState, event: DetectGateEvent): DetectGateOutcome {
  if (!event.positive || isRepeat(state, event.fingerprint, event.lastAnswered)) {
    return { state: resetHits(state, event.finalCount), fire: false, scheduleSilenceMs: null };
  }

  const sameQuestion = state.fingerprint === event.fingerprint;
  const newSpeech = event.finalCount > state.lastFinalCount;

  if (sameQuestion && state.hits >= 1 && !newSpeech) {
    return {
      state: { ...state, lastFinalCount: event.finalCount },
      fire: false,
      scheduleSilenceMs: null,
    };
  }

  const hits = sameQuestion && newSpeech ? state.hits + 1 : 1;
  const next: DetectGateState = {
    ...state,
    hits,
    fingerprint: event.fingerprint,
    lastHitAtMs: event.nowMs,
    lastFinalCount: event.finalCount,
  };

  if (hits >= 2) {
    return { state: markFired(next, event.fingerprint, event.finalCount), fire: true, scheduleSilenceMs: null };
  }

  return { state: next, fire: false, scheduleSilenceMs: SILENCE_CONFIRM_MS };
}

/** Call after ~1s with no new finals. Fires the pending single hit. */
export function confirmSilence(
  state: DetectGateState,
  opts: { nowMs: number; finalCount: number; lastAnswered: string | null },
): DetectGateOutcome {
  if (state.hits < 1 || !state.fingerprint) {
    return { state, fire: false, scheduleSilenceMs: null };
  }
  if (opts.finalCount !== state.lastFinalCount) {
    return { state, fire: false, scheduleSilenceMs: null };
  }
  if (isRepeat(state, state.fingerprint, opts.lastAnswered)) {
    return { state: resetHits(state, opts.finalCount), fire: false, scheduleSilenceMs: null };
  }
  const elapsed = state.lastHitAtMs == null ? SILENCE_CONFIRM_MS : opts.nowMs - state.lastHitAtMs;
  if (elapsed < SILENCE_CONFIRM_MS) {
    return { state, fire: false, scheduleSilenceMs: SILENCE_CONFIRM_MS - elapsed };
  }
  return {
    state: markFired(state, state.fingerprint, opts.finalCount),
    fire: true,
    scheduleSilenceMs: null,
  };
}
