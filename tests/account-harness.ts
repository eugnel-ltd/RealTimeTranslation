import ReactRuntime from '../client/node_modules/react';
import type { ReactNode } from 'react';
const React = ReactRuntime as typeof import('react');

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: void | (() => void) };
type Internals = { __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: { ReactCurrentDispatcher: { current: unknown } } };
const internals = (React as unknown as Internals).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

/** Small typed hook runner; invokes real components/effects and retains real callbacks. */
export function hookHarness<P extends object>(component: (props: P) => ReactNode, initial: P) {
  const slots: Slot[] = [];
  let cursor = 0;
  let effects: Array<() => void> = [];
  let tree: ReactNode;
  let mounted = true;
  let lateWrites = 0;
  let currentProps = initial;
  const memo = (factory: () => unknown, deps?: readonly unknown[]) => {
    const id = cursor++;
    if (!slots[id] || !deps || deps.some((dep, i) => dep !== slots[id].deps?.[i])) slots[id] = { value: factory(), deps };
    return slots[id].value;
  };
  const dispatcher = {
    useState(initialValue: unknown) {
      const id = cursor++;
      if (!slots[id]) slots[id] = { value: typeof initialValue === 'function' ? (initialValue as () => unknown)() : initialValue };
      return [slots[id].value, (next: unknown) => {
        if (!mounted) lateWrites++;
        slots[id].value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(slots[id].value) : next;
      }];
    },
    useRef(initialValue: unknown) { const id = cursor++; return (slots[id] ??= { value: { current: initialValue } }).value; },
    useMemo: memo,
    useCallback: (fn: unknown, deps: readonly unknown[]) => memo(() => fn, deps),
    useEffect(fn: () => void | (() => void), deps?: readonly unknown[]) {
      const id = cursor++;
      if (!slots[id] || !deps || deps.some((dep, i) => dep !== slots[id].deps?.[i])) {
        effects.push(() => { slots[id]?.cleanup?.(); slots[id] = { deps, cleanup: fn() }; });
      }
    },
  };
  return {
    render(props = currentProps) {
      currentProps = props; cursor = 0; effects = [];
      internals.ReactCurrentDispatcher.current = dispatcher;
      try { tree = component(props); } finally { internals.ReactCurrentDispatcher.current = null; }
      effects.forEach((effect) => effect());
      return tree;
    },
    get tree() { return tree; },
    get lateWrites() { return lateWrites; },
    unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); },
  };
}

export function findProps<T>(node: ReactNode, name: string): T | undefined {
  if (!React.isValidElement<{ children?: ReactNode }>(node)) return undefined;
  const type = node.type;
  if ((typeof type === 'function' && type.name === name) || type === name) return node.props as T;
  for (const child of React.Children.toArray(node.props.children)) {
    const found = findProps<T>(child, name);
    if (found) return found;
  }
  return undefined;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
