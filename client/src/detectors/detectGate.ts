import { SILENCE_CONFIRM_MS, TWO_HIT_WINDOW_MS } from '../../../shared/extractWindow';

export type DetectGateState = {
  hits: number;
  fingerprint: string | null;
  lastHitAtMs: number | null;
  lastFinalCount: number;
  firedFingerprint: string | null;
  lastAnsweredEndId: number | null;
};

export type DetectGateEvent = {
  positive: boolean;
  /** Absolute newest-final id, e.g. `a:42`. */
  fingerprint: string;
  newestId: number | null;
  nowMs: number;
  finalCount: number;
  lastAnsweredEndId: number | null;
};

export type DetectGateOutcome = {
  state: DetectGateState;
  fire: boolean;
  scheduleSilenceMs: number | null;
};

export function createDetectGateState(): DetectGateState {
  return {
    hits: 0,
    fingerprint: null,
    lastHitAtMs: null,
    lastFinalCount: 0,
    firedFingerprint: null,
    lastAnsweredEndId: null,
  };
}

function resetHits(state: DetectGateState, finalCount: number, lastEnd: number | null): DetectGateState {
  return {
    ...state,
    hits: 0,
    fingerprint: null,
    lastHitAtMs: null,
    lastFinalCount: finalCount,
    lastAnsweredEndId: lastEnd,
  };
}

function markFired(state: DetectGateState, fingerprint: string, finalCount: number, lastEnd: number | null): DetectGateState {
  return {
    ...state,
    hits: 0,
    fingerprint: null,
    lastHitAtMs: null,
    lastFinalCount: finalCount,
    firedFingerprint: fingerprint,
    lastAnsweredEndId: lastEnd,
  };
}

function behindLastAnswer(newestId: number | null, lastEnd: number | null): boolean {
  return lastEnd != null && newestId != null && newestId <= lastEnd;
}

/** 1 Jev hit + ~1.5s silence, or 2 hits within ~3s. Negative (candidate talking) does not clear a pending hit. */
export function nextDetectGate(state: DetectGateState, event: DetectGateEvent): DetectGateOutcome {
  const lastEnd = event.lastAnsweredEndId;
  if (behindLastAnswer(event.newestId, lastEnd)) {
    return { state: resetHits(state, event.finalCount, lastEnd), fire: false, scheduleSilenceMs: null };
  }

  if (!event.positive) {
    if (state.hits >= 1 && state.lastHitAtMs != null) {
      return {
        state: { ...state, lastFinalCount: event.finalCount, lastAnsweredEndId: lastEnd },
        fire: false,
        scheduleSilenceMs: null,
      };
    }
    return { state: resetHits(state, event.finalCount, lastEnd), fire: false, scheduleSilenceMs: null };
  }

  if (state.firedFingerprint != null && event.fingerprint === state.firedFingerprint) {
    return {
      state: { ...state, lastFinalCount: event.finalCount, lastAnsweredEndId: lastEnd },
      fire: false,
      scheduleSilenceMs: null,
    };
  }

  const withinTwoHit =
    state.hits >= 1 && state.lastHitAtMs != null && event.nowMs - state.lastHitAtMs <= TWO_HIT_WINDOW_MS;
  const hits = withinTwoHit ? state.hits + 1 : 1;
  const next: DetectGateState = {
    ...state,
    hits,
    fingerprint: event.fingerprint,
    lastHitAtMs: event.nowMs,
    lastFinalCount: event.finalCount,
    lastAnsweredEndId: lastEnd,
  };

  if (hits >= 2) {
    return { state: markFired(next, event.fingerprint, event.finalCount, lastEnd), fire: true, scheduleSilenceMs: null };
  }

  return { state: next, fire: false, scheduleSilenceMs: SILENCE_CONFIRM_MS };
}

/** Fire the pending hit ~1.5s after the last positive, even if later finals are the candidate answering. */
export function confirmSilence(
  state: DetectGateState,
  opts: { nowMs: number; newestId: number | null; lastAnsweredEndId: number | null },
): DetectGateOutcome {
  if (state.hits < 1 || !state.fingerprint) {
    return { state, fire: false, scheduleSilenceMs: null };
  }
  if (behindLastAnswer(opts.newestId, opts.lastAnsweredEndId)) {
    return { state: resetHits(state, state.lastFinalCount, opts.lastAnsweredEndId), fire: false, scheduleSilenceMs: null };
  }
  const elapsed = state.lastHitAtMs == null ? SILENCE_CONFIRM_MS : opts.nowMs - state.lastHitAtMs;
  if (elapsed < SILENCE_CONFIRM_MS) {
    return { state, fire: false, scheduleSilenceMs: SILENCE_CONFIRM_MS - elapsed };
  }
  return {
    state: markFired(state, state.fingerprint, state.lastFinalCount, opts.lastAnsweredEndId),
    fire: true,
    scheduleSilenceMs: null,
  };
}
