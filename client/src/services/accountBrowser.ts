import { createAppRuntime, type AppRuntime } from './accountLifetime';
import { createStorageScope, isObject, type StorageScope } from './browserStorage';
import { AccountError, accountMessage, accountRequest, parseAccount, parseDeletion, type DeletionReceipt, type EnabledAccount } from './accounts';

export type BrowserAccountState =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string; retry: 'bootstrap' | 'signout' | 'deletion' }
  | { status: 'owner'; runtime: AppRuntime }
  | { status: 'signed-out'; account: EnabledAccount; reauth?: boolean }
  | { status: 'account'; account: EnabledAccount; runtime: AppRuntime }
  | { status: 'deletion'; receipt: DeletionReceipt; cacheMessage: string };

/** One coordinator per mounted browser boundary; no identity is stored globally. */
export class AccountBrowser {
  private state: BrowserAccountState = { status: 'loading' };
  private listeners = new Set<(state: BrowserAccountState) => void>();
  private generation = 0;
  private verification: AbortController | null = null;
  private controls = new AbortController();
  private disposed = false;
  private pendingCache: { storage: StorageScope; jobId: string } | null = null;
  private expireTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly origin: string, private readonly announce: () => void = () => undefined) {}
  get current(): BrowserAccountState { return this.state; }
  subscribe(listener: (state: BrowserAccountState) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private update(state: BrowserAccountState) {
    if (this.disposed) return;
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
  private revoke() {
    if (this.expireTimer) clearTimeout(this.expireTimer);
    this.expireTimer = null;
    if (this.state.status === 'owner' || this.state.status === 'account') this.state.runtime.revoke();
  }
  private begin() {
    ++this.generation; this.verification?.abort(); this.revoke(); this.update({ status: 'loading' });
    return this.generation;
  }
  private fresh(generation: number) { return !this.disposed && generation === this.generation; }
  private armExpiry(account: EnabledAccount, runtime: AppRuntime) {
    if (this.expireTimer) clearTimeout(this.expireTimer);
    if (!account.session) return;
    const wait = Math.max(0, Math.min(2_147_000_000, Date.parse(account.session.expiresAt) - Date.now()));
    this.expireTimer = setTimeout(() => {
      if (!runtime.active) return;
      if (Date.parse(account.session!.expiresAt) <= Date.now()) runtime.invalidate();
      else this.armExpiry(account, runtime);
    }, wait);
  }
  private receiveDeletion(receipt: DeletionReceipt) {
    let cacheMessage = 'Browser caches on other devices, unassigned browser data and backups are not removed by this receipt.';
    if (receipt.state === 'completed') {
      if (this.pendingCache?.jobId === receipt.jobId) {
        cacheMessage = this.pendingCache.storage.clearConfirmedAccountCache()
          ? 'This account’s known cache keys were removed from this browser. Other devices, unassigned browser data and backups remain separate.'
          : 'Server erasure completed. This browser could not remove its cache; clear this site’s browser data manually.';
        if (!cacheMessage.includes('could not')) this.pendingCache = null;
      } else cacheMessage = 'Server erasure completed. This page cannot identify an account cache after reload; clear this site’s browser data if needed. Other devices and backups remain separate.';
    }
    this.update({ status: 'deletion', receipt, cacheMessage });
  }

  /** Hints invalidate immediately; polling preserves a still-verified identical lifetime. */
  async refresh(invalidate = false): Promise<void> {
    if (this.disposed) return;
    const previous = this.state;
    const generation = invalidate ? this.begin() : ++this.generation;
    this.verification?.abort();
    const request = new AbortController(); this.verification = request;
    try {
      const result = parseAccount(await accountRequest('/api/account', undefined, request.signal), this.origin);
      if (!this.fresh(generation)) return;
      if (!result.enabled) {
        if (previous.status === 'owner' && previous.runtime.active && !invalidate) return;
        this.revoke();
        this.update({ status: 'owner', runtime: createAppRuntime(createStorageScope(), false, () => { void this.refresh(true); }) });
        return;
      }
      if (result.session) {
        const same = previous.status === 'account' && previous.runtime.active && !invalidate &&
          JSON.stringify(previous.account.scope) === JSON.stringify(result.scope) &&
          JSON.stringify(previous.account.session) === JSON.stringify(result.session);
        if (same) { this.update({ status: 'account', account: result, runtime: previous.runtime }); return; }
        this.revoke();
        const runtime = createAppRuntime(createStorageScope({ ...result.scope, accountId: result.session.accountId }), true, () => { void this.refresh(true); });
        this.update({ status: 'account', account: result, runtime });
        this.armExpiry(result, runtime);
        return;
      }
      this.revoke();
      try {
        const receipt = parseDeletion(await accountRequest('/api/account/delete/status', undefined, request.signal));
        if (this.fresh(generation)) this.receiveDeletion(receipt);
      } catch (error) {
        if (!this.fresh(generation)) return;
        if (error instanceof AccountError && error.status === 401 && error.code === 'DELETE_TICKET_INVALID') {
          this.update({ status: 'signed-out', account: result });
        } else throw error;
      }
    } catch (error) {
      if (!this.fresh(generation)) return;
      this.revoke();
      this.update({ status: 'unavailable', message: accountMessage(error), retry: 'bootstrap' });
    }
  }
  async startEmail(email: string, turnstile: string): Promise<void> {
    const result = await accountRequest('/api/auth/email/start', { email, turnstile }, this.controls.signal);
    if (!isObject(result) || result.ok !== true) throw new AccountError('SERVICE_UNAVAILABLE', 503);
  }
  async verifyEmail(email: string, code: string): Promise<void> {
    this.begin();
    try {
      const result = await accountRequest('/api/auth/email/verify', { email, code }, this.controls.signal);
      if (!isObject(result) || result.ok !== true) throw new AccountError('SERVICE_UNAVAILABLE', 503);
      this.announce(); await this.refresh();
    } catch (error) {
      if (!this.disposed) this.update({ status: 'unavailable', message: accountMessage(error), retry: 'bootstrap' });
      throw error;
    }
  }
  async signout(): Promise<void> {
    this.begin(); this.announce();
    try {
      const result = await accountRequest('/api/auth/signout', {}, this.controls.signal);
      if (!isObject(result) || result.ok !== true) throw new AccountError('SERVICE_UNAVAILABLE', 503);
      this.announce(); await this.refresh();
    } catch (error) {
      if (!this.disposed) this.update({ status: 'unavailable', message: accountMessage(error), retry: 'signout' });
    }
  }
  oauth(provider: 'google' | 'apple'): void {
    this.begin(); this.announce();
    window.location.assign(`/api/auth/${provider}/start`);
  }
  async cancelGoogle(): Promise<void> {
    await accountRequest('/api/auth/google/cancel', {}, this.controls.signal);
    await this.refresh(true);
  }
  async deleteAccount(): Promise<void> {
    if (this.state.status !== 'account') return;
    const { account, runtime } = this.state;
    this.begin(); this.announce();
    try {
      const result = await accountRequest('/api/account/delete', { confirm: true }, this.controls.signal);
      // The creation response intentionally omits completedAt; a start never claims completion.
      if (!isObject(result) || result.state !== 'pending') throw new AccountError('SERVICE_UNAVAILABLE', 503);
      const receipt = parseDeletion({ ...result, completedAt: null });
      if (this.disposed) return;
      this.pendingCache = { storage: runtime.storage, jobId: receipt.jobId };
      this.announce(); this.receiveDeletion(receipt);
    } catch (error) {
      if (this.disposed) return;
      if (error instanceof AccountError && error.code === 'REAUTH_REQUIRED') {
        this.update({ status: 'signed-out', account: { ...account, session: null }, reauth: true });
      } else this.update({ status: 'unavailable', message: accountMessage(error), retry: 'deletion' });
    }
  }
  async deletionStep(advance: boolean): Promise<void> {
    const generation = this.begin();
    try {
      const receipt = parseDeletion(await accountRequest(`/api/account/delete/${advance ? 'advance' : 'status'}`, advance ? {} : undefined, this.controls.signal));
      if (this.fresh(generation)) { this.receiveDeletion(receipt); if (receipt.state === 'completed') this.announce(); }
    } catch (error) {
      if (this.fresh(generation)) this.update({ status: 'unavailable', message: accountMessage(error), retry: 'deletion' });
    }
  }
  dispose(): void {
    this.revoke(); this.disposed = true; ++this.generation;
    this.verification?.abort(); this.controls.abort(); this.listeners.clear();
  }
}
