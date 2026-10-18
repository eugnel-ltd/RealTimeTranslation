import type { StorageScope } from './browserStorage';

export interface AppRuntime {
  readonly storage: StorageScope;
  readonly signal: AbortSignal;
  readonly active: boolean;
  readonly accountMode?: boolean;
  onRevoke(callback: () => void): () => void;
  revoke(): void;
  invalidate(): void;
}

export function createAppRuntime(storage: StorageScope, accountMode: boolean, onInvalidated: () => void): AppRuntime {
  const abort = new AbortController();
  const callbacks = new Set<() => void>();
  let notified = false;
  const revoke = () => {
    if (abort.signal.aborted) return;
    storage.revoke();
    abort.abort();
    for (const callback of callbacks) callback();
    callbacks.clear();
  };
  return Object.freeze({
    storage, signal: abort.signal, accountMode,
    get active() { return storage.active && !abort.signal.aborted; }, revoke,
    invalidate() {
      revoke();
      if (!notified) { notified = true; onInvalidated(); }
    },
    onRevoke(callback: () => void) {
      if (abort.signal.aborted) callback();
      else callbacks.add(callback);
      return () => { callbacks.delete(callback); };
    },
  });
}

export function assertRuntime(runtime?: AppRuntime): void {
  if (runtime && !runtime.active) throw new DOMException('Account changed', 'AbortError');
}
