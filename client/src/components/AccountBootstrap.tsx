import { useEffect, useState } from 'react';
import App from '../App';
import { AccountBrowser, type BrowserAccountState } from '../services/accountBrowser';
import { AccountControls } from './AccountControls';

const HINT_KEY = 'rtt_account_change';

function LegalLinks() {
  return <footer aria-label="Legal and data controls">
    <a href="/legal/privacy/">Privacy</a>{' · '}
    <a href="/legal/terms/">Terms</a>{' · '}
    <a href="/legal/refunds/">Free service and refunds</a>{' · '}
    <a href="/legal/data-use/">Data use and storage choices</a>
  </footer>;
}

export default function AccountBootstrap() {
  const [state, setState] = useState<BrowserAccountState>({ status: 'loading' });
  const [browser, setBrowser] = useState<AccountBrowser | null>(null);
  const [returned, setReturned] = useState({ code: false, failed: false });
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel('rtt_account_change');
    const announce = () => {
      const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      channel?.postMessage({ change: nonce });
      try { localStorage.setItem(HINT_KEY, nonce); } catch { /* Broadcast or focus verification remains available. */ }
    };
    const manager = new AccountBrowser(window.location.origin, announce);
    const unsubscribe = manager.subscribe(setState);
    setBrowser(manager); setState(manager.current);
    const current = new URL(window.location.href);
    setReturned({ code: current.searchParams.get('auth_code') === '1', failed: current.searchParams.has('auth_error') });
    if (current.searchParams.has('auth_error') || current.searchParams.has('auth_code')) {
      current.searchParams.delete('auth_error'); current.searchParams.delete('auth_code');
      window.history.replaceState(null, '', `${current.pathname}${current.search}${current.hash}`);
    }
    const hint = () => { void manager.refresh(true); };
    const storageHint = (event: StorageEvent) => { if (event.key === HINT_KEY) hint(); };
    const refresh = () => { void manager.refresh(); };
    const onVisibilityChange = () => { if (!document.hidden) refresh(); };
    channel?.addEventListener('message', hint);
    window.addEventListener('storage', storageHint);
    window.addEventListener('focus', refresh);
    document.addEventListener?.('visibilitychange', onVisibilityChange);
    const poll = setInterval(refresh, 60_000);
    void manager.refresh();
    return () => {
      unsubscribe(); manager.dispose(); clearInterval(poll);
      channel?.removeEventListener('message', hint); channel?.close();
      window.removeEventListener('storage', storageHint);
      window.removeEventListener('focus', refresh);
      document.removeEventListener?.('visibilitychange', onVisibilityChange);
    };
  }, []);

  if (state.status === 'owner') return <App key={state.runtime.id} runtime={state.runtime} />;
  if (state.status === 'account' && browser) return <App key={state.runtime.id} runtime={state.runtime}
    accountControls={<AccountControls browser={browser} account={state.account} codePrompt={returned.code} onCodeVerified={() => setReturned({ code: false, failed: false })} />} />;
  return <>
    <main className="container mx-auto px-4 py-8">
      {returned.failed && <p role="alert">Sign-in did not complete. Try an existing sign-in method again.</p>}
      {state.status === 'loading' && <p role="status">Checking account access…</p>}
      {state.status === 'unavailable' && browser && <>
        <p role="alert">{state.message}</p>
        <button onClick={() => {
          if (state.retry === 'signout') void browser.signout();
          else if (state.retry === 'deletion') void browser.deletionStep(false);
          else void browser.refresh(true);
        }}>Retry {state.retry === 'signout' ? 'sign out' : state.retry === 'deletion' ? 'deletion status' : 'account access'}</button>
        {state.retry === 'deletion' && <button onClick={() => { void browser.refresh(true); }}>Verify an existing sign-in method</button>}
      </>}
      {state.status === 'signed-out' && browser && <AccountControls browser={browser} account={state.account} reauth={state.reauth} codePrompt={returned.code} onCodeVerified={() => setReturned({ code: false, failed: false })} />}
      {state.status === 'deletion' && browser && <>
        <h2>Account deletion {state.receipt.state === 'completed' ? 'completed' : 'in progress'}</h2>
        <p role="status">{state.receipt.phase}</p><p>{state.cacheMessage}</p>
        {state.receipt.state === 'pending' && <button onClick={() => { void browser.deletionStep(true); }}>Continue / retry account deletion</button>}
        <button onClick={() => { void browser.signout(); }}>Sign out / sign in again</button>
        <button onClick={() => { void browser.refresh(true); }}>Check account access</button>
      </>}
    </main>
    <LegalLinks />
  </>;
}
