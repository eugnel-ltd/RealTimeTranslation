import { afterEach, expect, it, vi } from 'vitest';
import ReactRuntime from '../client/node_modules/react';
import type { ReactNode } from 'react';
import AccountBootstrap from '../client/src/components/AccountBootstrap';
import { flush, hookHarness } from './account-harness';

const React = ReactRuntime as typeof import('react');
function appKey(node: ReactNode): string | null | undefined {
  if (!React.isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (typeof node.type === 'function' && node.type.name === 'App') return node.key;
  for (const child of React.Children.toArray(node.props.children)) {
    const key = appKey(child); if (key !== undefined) return key;
  }
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('remounts App for a renewed same-account lifetime, but retains it for identical session polling', async () => {
  vi.useFakeTimers();
  let expiresAt = '2099-10-18T12:00:00.000Z';
  const events = new Map<string, EventListener>();
  vi.stubGlobal('window', {
    location: { origin: 'https://rtt.example.test', href: 'https://rtt.example.test/' },
    addEventListener: (name: string, callback: EventListener) => events.set(name, callback),
    removeEventListener: (name: string) => events.delete(name), history: { replaceState() {} },
  });
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    enabled: true, scope: { productId: 'rtt', environment: 'preview', origin: 'https://rtt.example.test' },
    session: { accountId: 'account_A', authenticatedAt: '2026-10-18T01:00:00Z', expiresAt }, ways: [],
    capabilities: { email: false, google: true, apple: false, siteKey: null },
  })));
  const run = hookHarness(AccountBootstrap, {});
  try {
    run.render(); await flush(); run.render();
    const original = appKey(run.tree); expect(original).toBeTruthy();
    events.get('focus')!(new Event('focus')); await flush(); run.render();
    expect(appKey(run.tree), 'identical session polling must retain the current App lifetime').toBe(original);
    expiresAt = '2099-10-19T12:00:00.000Z';
    events.get('focus')!(new Event('focus')); await flush(); run.render();
    expect(appKey(run.tree), 'a renewed session must remount settings/history consent state from captured account storage').not.toBe(original);
  } finally { run.unmount(); }
});
