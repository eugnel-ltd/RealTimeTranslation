import { createAppRuntime, type AppRuntime } from './accountLifetime';
import { accountExpectation, createStorageScope, isObject, type StorageScope } from './browserStorage';
import { AccountError, accountMessage, accountRequest, parseAccount, parseDeletion, type DeletionReceipt, type EnabledAccount } from './accounts';

export type BrowserAccountState =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string; retry: 'bootstrap' | 'signout' | 'deletion' }
  | { status: 'owner'; runtime: AppRuntime }
  | { status: 'signed-out'; account: EnabledAccount; reauth?: boolean }
  | { status: 'account'; account: EnabledAccount; runtime: AppRuntime }
  | { status: 'deletion'; receipt: DeletionReceipt; cacheMessage: string };
type Recovery = { kind: 'signout' | 'reauth' | 'deletion'; expected: string; message?: string };
type Control = { generation: number; expected: string };

/** Unsettled control responses never coexist with personal App activity. */
export class AccountBrowser {
  private state: BrowserAccountState = { status: 'loading' };
  private listeners = new Set<(state: BrowserAccountState) => void>();
  private generation = 0;
  private verification: AbortController | null = null;
  private controls = new AbortController();
  private disposed = false;
  private pendingControls = 0;
  private expected: string | undefined;
  private recovery: Recovery | null = null;
  private codeEmail: { expected: string; email: string } | null = null;
  private message = '';
  private pendingCache: { storage: StorageScope; jobId: string } | null = null;
  private expireTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly origin: string, private readonly announce: () => void = () => undefined) {}
  get current(): BrowserAccountState { return this.state; }
  get expectation(): string | undefined { return this.expected; }
  get emailForCode(): string | undefined { return this.codeEmail?.expected === this.expected ? this.codeEmail?.email : undefined; }
  get controlMessage(): string { return this.message; }
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
  private capture(expected = this.expected): string {
    if (!expected || expected !== this.expected) throw new AccountError('ACCOUNT_CHANGED', 401);
    return expected;
  }
  private control(expected?: string): Control {
    const captured = this.capture(expected);
    if (this.pendingControls) throw new AccountError('REQUEST_INVALID', 409);
    const generation = this.begin(); ++this.pendingControls; this.message = '';
    return { generation, expected: captured };
  }
  private async settled() {
    --this.pendingControls;
    if (!this.disposed && this.pendingControls === 0) { this.announce(); await this.refresh(true); }
  }
  private setExpected(expected?: string) {
    if (expected !== this.expected) { this.codeEmail = null; this.message = ''; }
    this.expected = expected;
    if (this.recovery?.expected !== expected) this.recovery = null;
  }
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

  /** Hints may verify during a hold, but cannot mount App until the response settles. */
  async refresh(invalidate = false): Promise<void> {
    if (this.disposed) return;
    const previous = this.state;
    const generation = invalidate ? this.begin() : ++this.generation;
    if (this.pendingControls) { this.revoke(); this.update({ status: 'loading' }); }
    this.verification?.abort();
    const request = new AbortController(); this.verification = request;
    try {
      const result = parseAccount(await accountRequest('/api/account', undefined, request.signal), this.origin);
      if (!this.fresh(generation) || this.pendingControls) return;
      this.setExpected(result.enabled ? result.session ? accountExpectation(result.session.accountId) : 'signed-out' : undefined);
      if (!result.enabled) {
        if (previous.status === 'owner' && previous.runtime.active && !invalidate) return;
        this.revoke(); this.update({ status: 'owner', runtime: createAppRuntime(createStorageScope(), false, () => { void this.refresh(true); }) }); return;
      }
      if (this.recovery) {
        if (this.recovery.kind === 'reauth') this.update({ status: 'signed-out', account: { ...result, session: null }, reauth: true });
        else this.update({ status: 'unavailable', message: this.recovery.message ?? 'Sign out did not complete. Retry sign out.', retry: this.recovery.kind === 'signout' ? 'signout' : 'deletion' });
        return;
      }
      if (result.session) {
        const same = previous.status === 'account' && previous.runtime.active && !invalidate &&
          JSON.stringify(previous.account.scope) === JSON.stringify(result.scope) && JSON.stringify(previous.account.session) === JSON.stringify(result.session);
        if (same) { this.update({ status: 'account', account: result, runtime: previous.runtime }); return; }
        this.revoke();
        const runtime = createAppRuntime(createStorageScope({ ...result.scope, accountId: result.session.accountId }), true, () => { void this.refresh(true); });
        this.update({ status: 'account', account: result, runtime }); this.armExpiry(result, runtime); return;
      }
      this.revoke();
      try {
        const receipt = parseDeletion(await accountRequest('/api/account/delete/status', undefined, request.signal));
        if (this.fresh(generation) && !this.pendingControls) this.receiveDeletion(receipt);
      } catch (error) {
        if (!this.fresh(generation) || this.pendingControls) return;
        if (error instanceof AccountError && error.status === 401 && error.code === 'DELETE_TICKET_INVALID') this.update({ status: 'signed-out', account: result });
        else throw error;
      }
    } catch (error) {
      if (!this.fresh(generation) || this.pendingControls) return;
      this.revoke(); this.update({ status: 'unavailable', message: accountMessage(error), retry: this.recovery?.kind === 'signout' ? 'signout' : 'bootstrap' });
    }
  }
  async startEmail(email: string, turnstile: string, expected?: string): Promise<void> {
    const control = this.control(expected);
    try {
      const result = await accountRequest('/api/auth/email/start', { email, turnstile }, this.controls.signal, control.expected);
      if (!isObject(result) || result.ok !== true) throw new AccountError('SERVICE_UNAVAILABLE', 503);
      // The address is our own in-memory input. Apply it only if the fresh
      // settled bootstrap still verifies this expectation; a benign focus may
      // have advanced the generation while every personal runtime was held.
      if (!this.disposed) this.codeEmail = { expected: control.expected, email };
      if (this.fresh(control.generation)) this.message = 'If this address can receive a code, check its inbox.';
    } catch (error) { if (this.fresh(control.generation)) this.message = accountMessage(error); throw error; }
    finally { await this.settled(); }
  }
  async verifyEmail(email: string, code: string, expected?: string): Promise<void> {
    const control = this.control(expected); this.codeEmail = null; this.recovery = null;
    try {
      const result = await accountRequest('/api/auth/email/verify', { email, code }, this.controls.signal, control.expected);
      if (!isObject(result) || result.ok !== true) throw new AccountError('SERVICE_UNAVAILABLE', 503);
    } catch (error) { if (this.fresh(control.generation)) this.message = accountMessage(error); throw error; }
    finally { await this.settled(); }
  }
  async signout(expected?: string): Promise<void> {
    const control = this.control(expected); this.codeEmail = null;
    const recovery: Recovery = { kind: 'signout', expected: control.expected };
    this.recovery = recovery; this.announce();
    try {
      const result = await accountRequest('/api/auth/signout', {}, this.controls.signal, control.expected);
      if (!isObject(result) || result.ok !== true) throw new AccountError('SERVICE_UNAVAILABLE', 503);
      if (this.recovery === recovery) this.recovery = null;
    } catch (error) { if (this.fresh(control.generation)) recovery.message = accountMessage(error); }
    finally { await this.settled(); }
  }
  oauth(provider: 'google' | 'apple', expected?: string): void {
    if (this.pendingControls) throw new AccountError('REQUEST_INVALID', 409);
    const captured = this.capture(expected); this.begin(); this.announce();
    window.location.assign(`/api/auth/${provider}/start?${new URLSearchParams({ expectedAccount: captured })}`);
  }
  async cancelGoogle(expected?: string): Promise<void> {
    const control = this.control(expected); this.codeEmail = null;
    try {
      const result = await accountRequest('/api/auth/google/cancel', {}, this.controls.signal, control.expected);
      if (!isObject(result) || result.ok !== true) throw new AccountError('SERVICE_UNAVAILABLE', 503);
    }
    finally { await this.settled(); }
  }
  async deleteAccount(expected?: string): Promise<void> {
    if (this.state.status !== 'account') return;
    const storage = this.state.runtime.storage;
    const control = this.control(expected);
    try {
      const result = await accountRequest('/api/account/delete', { confirm: true }, this.controls.signal, control.expected);
      if (!isObject(result) || result.state !== 'pending') throw new AccountError('SERVICE_UNAVAILABLE', 503);
      const receipt = parseDeletion({ ...result, completedAt: null });
      if (this.fresh(control.generation)) this.pendingCache = { storage, jobId: receipt.jobId };
    } catch (error) {
      if (this.fresh(control.generation)) this.recovery = {
        kind: error instanceof AccountError && error.code === 'REAUTH_REQUIRED' ? 'reauth' : 'deletion',
        expected: control.expected, message: accountMessage(error),
      };
    } finally { await this.settled(); }
  }
  async deletionStep(advance: boolean): Promise<void> {
    const control = this.control(); this.recovery = null;
    try { parseDeletion(await accountRequest(`/api/account/delete/${advance ? 'advance' : 'status'}`, advance ? {} : undefined, this.controls.signal, control.expected)); }
    catch (error) {
      if (this.fresh(control.generation)) this.recovery = { kind: 'deletion', expected: control.expected, message: accountMessage(error) };
    } finally { await this.settled(); }
  }
  dispose(): void {
    this.revoke(); this.disposed = true; ++this.generation; this.codeEmail = null;
    this.verification?.abort(); this.controls.abort(); this.listeners.clear();
  }
}
