import React from '../client/node_modules/react';
import Settings from '../client/src/components/Settings';
import { SettingsService } from '../client/src/services/settings';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('shows a visible save error when withdrawing history cannot update browser storage', async () => {
  const old = JSON.stringify({ saveTranscriptHistory: true });
  vi.stubGlobal('localStorage', { getItem: () => old, setItem: () => { throw new Error('Storage full'); } });
  const service = SettingsService.getInstance();
  const slots: any[] = [];
  let cursor = 0;
  let tree: any;
  const internals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  function render() {
    cursor = 0;
    internals.ReactCurrentDispatcher.current = {
      useState(initial: any) {
        const id = cursor++;
        if (!(id in slots)) slots[id] = initial;
        return [slots[id], (next: any) => { slots[id] = typeof next === 'function' ? next(slots[id]) : next; }];
      },
      useRef(initial: any) { const id = cursor++; return slots[id] ??= { current: initial }; },
      useEffect() {},
    };
    try {
      tree = Settings({ isOpen: true, onClose() {}, initialSettings: service.getSettings(), onUpdate: (settings) => { service.updateSettings(settings); } });
    } finally { internals.ReactCurrentDispatcher.current = null; }
  }
  function find(predicate: (node: any) => boolean, node = tree): any {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      if (child == null) continue;
      const found = find(predicate, child);
      if (found) return found;
    }
  }
  render();
  find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: false } });
  render();
  await find((node) => node.type === 'button' && node.props.children === 'Save Changes').props.onClick();
  render();
  expect(find((node) => node.props?.role === 'alert')?.props.children).toMatch(/choice could not be saved/i);
  expect(service.getSettings().saveTranscriptHistory).toBe(false);
});
