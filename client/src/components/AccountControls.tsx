import { useEffect, useRef, useState } from 'react';
import type { AccountBrowser } from '../services/accountBrowser';
import { accountMessage, type EnabledAccount } from '../services/accounts';

type TurnstileClient = {
  render(container: HTMLElement, options: { sitekey: string; callback(value: string): void; 'expired-callback'(): void; 'error-callback'(): void }): string;
  remove(id: string): void;
};
declare global { interface Window { turnstile?: TurnstileClient } }

function Turnstile({ siteKey, onToken }: { siteKey: string; onToken(token: string): void }) {
  const element = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  useEffect(() => {
    let active = true;
    let widget: string | undefined;
    callback.current('');
    const render = () => {
      if (!active || widget !== undefined || !element.current || !window.turnstile) return;
      widget = window.turnstile.render(element.current, {
        sitekey: siteKey,
        callback: (value) => { if (active) callback.current(value); },
        'expired-callback': () => { if (active) callback.current(''); },
        'error-callback': () => { if (active) callback.current(''); },
      });
    };
    let script = document.getElementById('rtt-turnstile') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script'); script.id = 'rtt-turnstile';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true; document.head.appendChild(script);
    }
    script.addEventListener('load', render);
    render();
    return () => {
      active = false; script?.removeEventListener('load', render);
      if (widget !== undefined) window.turnstile?.remove(widget);
    };
  }, [siteKey]);
  return <div ref={element} aria-label="Email verification challenge" />;
}

const inputClass = 'w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';
const buttonClass = 'px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm';

export function AccountControls({ browser, account, expectation, reauth = false, codePrompt = false, onCodeVerified }: {
  browser: AccountBrowser; account: EnabledAccount; expectation?: string; reauth?: boolean; codePrompt?: boolean; onCodeVerified?: () => void;
}) {
  const [email, setEmail] = useState(browser.emailForCode ?? '');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [challenge, setChallenge] = useState(0);
  const [sent, setSent] = useState(codePrompt || !!browser.emailForCode);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(browser.controlMessage);
  const [confirmed, setConfirmed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const work = async (operation: () => Promise<void>) => {
    if (busy || !mounted.current) return;
    setBusy(true); setMessage('');
    try { await operation(); } catch (error) { if (mounted.current) setMessage(accountMessage(error)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const content = (
    <div className="space-y-4">
      <h2>{reauth ? 'Verify your account again' : account.session ? 'Account and sign-in methods' : 'Sign in'}</h2>
      {reauth && <p>Use an existing method, then confirm deletion again. A successful proof for an account already being erased resumes its deletion job.</p>}
      {account.session && <p>Use an existing method to refresh verification, or verify another method to link it to this account. At most five methods can be linked.</p>}
      {account.ways.length > 0 && <ul aria-label="Verified sign-in methods">{account.ways.map((method, index) => <li key={`${method.provider}:${index}`}>{method.provider}{method.email ? `: ${method.email}` : ''}</li>)}</ul>}
      {message && <p role="alert">{message}</p>}
      {account.capabilities.email && account.capabilities.siteKey && (
        <>
          <form aria-label="Email sign-in" className="space-y-2" onSubmit={(event) => {
            event.preventDefault();
            if (!email.trim() || !token) return;
            void work(async () => {
              try {
                await browser.startEmail(email.trim(), token, expectation);
                if (mounted.current) { setSent(true); setMessage('If this address can receive a code, check its inbox.'); }
              } finally { if (mounted.current) { setToken(''); setChallenge((value) => value + 1); } }
            });
          }}>
            <label>Email address<input className={inputClass} type="email" required maxLength={320} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
            <Turnstile key={challenge} siteKey={account.capabilities.siteKey} onToken={setToken} />
            <button className={buttonClass} type="submit" disabled={busy || !token}>Send email code</button>
          </form>
          {sent && <form aria-label="Verify email code" className="space-y-2" onSubmit={(event) => {
            event.preventDefault();
            if (!email.trim() || !/^\d{6}$/.test(code)) return;
            void work(async () => { await browser.verifyEmail(email.trim(), code, expectation); onCodeVerified?.(); });
          }}>
            {codePrompt && <p>Enter the email address and emailed code to finish Google verification.</p>}
            <label>Email code<input className={inputClass} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} /></label>
            <button className={buttonClass} type="submit" disabled={busy || !email.trim() || !/^\d{6}$/.test(code)}>Verify code</button>
          </form>}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {account.capabilities.google && <button className={buttonClass} disabled={busy} onClick={() => { void work(async () => browser.oauth('google', expectation)); }}>Continue with Google</button>}
        {account.capabilities.apple && <button className={buttonClass} disabled={busy} onClick={() => { void work(async () => browser.oauth('apple', expectation)); }}>Continue with Apple</button>}
        {codePrompt && <button className={buttonClass} disabled={busy} onClick={() => { void work(async () => { await browser.cancelGoogle(expectation); onCodeVerified?.(); }); }}>Cancel pending Google verification</button>}
        {(account.session || reauth) && <button className={buttonClass} disabled={busy} onClick={() => { void work(() => browser.signout(expectation)); }}>Sign out / switch account</button>}
      </div>
      {account.session && <form aria-label="Delete account" className="space-y-2" onSubmit={(event) => {
        event.preventDefault(); if (confirmed) void work(() => browser.deleteAccount(expectation));
      }}>
        <p>Deletion stops this session and erases account data through a retryable server job. Browser cache is removed here only after confirmed server completion. Other devices, unassigned browser data and backups remain separate.</p>
        <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} /> I confirm account deletion</label>
        <button className={buttonClass} type="submit" disabled={busy || !confirmed}>Delete account</button>
      </form>}
    </div>
  );
  return account.session ? <details open={sent || !!message}><summary>Account</summary>{content}</details> : content;
}
