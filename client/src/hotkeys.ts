export type HotkeyAction =
  | 'toggleRecording'
  | 'answerNow'
  | 'clear'
  | 'openSettings'
  | 'tabTranscription'
  | 'tabHistory'
  | 'toggleLayout'
  | 'copyAnswer'
  | 'showHelp';

export type HotkeyMap = Record<HotkeyAction, string>;

export const DEFAULT_HOTKEYS: HotkeyMap = {
  toggleRecording: 'KeyR',
  answerNow: 'KeyA',
  clear: 'KeyX',
  openSettings: 'Comma',
  tabTranscription: 'Digit1',
  tabHistory: 'Digit2',
  toggleLayout: 'KeyL',
  copyAnswer: 'KeyY',
  showHelp: 'Shift+Slash',
};

export const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  toggleRecording: 'Start / Stop recording',
  answerNow: 'Answer now',
  clear: 'Clear transcript',
  openSettings: 'Open Settings',
  tabTranscription: 'Transcription tab',
  tabHistory: 'History tab',
  toggleLayout: 'Toggle split layout',
  copyAnswer: 'Copy latest answer',
  showHelp: 'Shortcut help',
};

type Parsed = {
  code: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
};

export function parseHotkey(shortcut: string): Parsed {
  const parts = shortcut.split('+').filter(Boolean);
  const parsed: Parsed = { code: 'Unidentified', alt: false, ctrl: false, meta: false, shift: false };
  for (const part of parts) {
    const p = part.trim();
    if (/^alt$/i.test(p)) parsed.alt = true;
    else if (/^(ctrl|control)$/i.test(p)) parsed.ctrl = true;
    else if (/^(meta|cmd|command)$/i.test(p)) parsed.meta = true;
    else if (/^shift$/i.test(p)) parsed.shift = true;
    else parsed.code = p;
  }
  return parsed;
}

export function formatHotkey(shortcut: string): string {
  return shortcut
    .replace(/^Key/, '')
    .replace('Digit', '')
    .replace('Slash', '/')
    .replace('Comma', ',')
    .replace('Shift+', 'Shift+');
}

export type HotkeyEvent = {
  code: string;
  key?: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export function eventMatchesHotkey(event: HotkeyEvent, shortcut: string): boolean {
  const parsed = parseHotkey(shortcut);
  if (event.code !== parsed.code) return false;
  if (event.altKey !== parsed.alt) return false;
  if (event.ctrlKey !== parsed.ctrl) return false;
  if (event.metaKey !== parsed.meta) return false;
  if (event.shiftKey !== parsed.shift) return false;
  return true;
}

export function shortcutFromEvent(event: HotkeyEvent): string {
  const mods: string[] = [];
  if (event.ctrlKey) mods.push('Control');
  if (event.altKey) mods.push('Alt');
  if (event.metaKey) mods.push('Meta');
  if (event.shiftKey) mods.push('Shift');
  mods.push(event.code);
  return mods.join('+');
}

export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { isContentEditable?: boolean; tagName?: string };
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
