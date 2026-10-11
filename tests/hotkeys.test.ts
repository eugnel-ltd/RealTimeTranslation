import { describe, expect, it } from 'vitest';
import { eventMatchesHotkey, parseHotkey, DEFAULT_HOTKEYS, HOTKEY_LABELS } from '../client/src/hotkeys';

function fakeEvent(partial: Partial<{ code: string; key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>): {
  code: string;
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
} {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    key: '',
    code: 'Unidentified',
    ...partial,
  };
}

describe('hotkeys', () => {
  it('parses modifier+code shortcuts', () => {
    expect(parseHotkey('Shift+Slash')).toEqual({
      code: 'Slash',
      alt: false,
      ctrl: false,
      meta: false,
      shift: true,
    });
  });

  it('matches KeyR without modifiers', () => {
    expect(eventMatchesHotkey(fakeEvent({ code: 'KeyR' }), DEFAULT_HOTKEYS.toggleRecording)).toBe(true);
    expect(eventMatchesHotkey(fakeEvent({ code: 'KeyR', ctrlKey: true }), DEFAULT_HOTKEYS.toggleRecording)).toBe(false);
  });

  it('defaults auto-detect, question-input, and AI Answer panel shortcuts without clashes', () => {
    expect(DEFAULT_HOTKEYS.toggleAutoDetect).toBe('KeyD');
    expect(DEFAULT_HOTKEYS.focusQuestionInput).toBe('KeyQ');
    expect(DEFAULT_HOTKEYS.toggleAiAnswer).toBe('KeyP');
    expect(eventMatchesHotkey(fakeEvent({ code: 'KeyD' }), DEFAULT_HOTKEYS.toggleAutoDetect)).toBe(true);
    expect(eventMatchesHotkey(fakeEvent({ code: 'KeyQ' }), DEFAULT_HOTKEYS.focusQuestionInput)).toBe(true);
    expect(eventMatchesHotkey(fakeEvent({ code: 'KeyP' }), DEFAULT_HOTKEYS.toggleAiAnswer)).toBe(true);
    const values = Object.values(DEFAULT_HOTKEYS);
    expect(new Set(values).size).toBe(values.length);
    expect(Object.keys(HOTKEY_LABELS).sort()).toEqual(Object.keys(DEFAULT_HOTKEYS).sort());
  });

  it('matches ? via Shift+Slash', () => {
    expect(eventMatchesHotkey(fakeEvent({ code: 'Slash', shiftKey: true, key: '?' }), DEFAULT_HOTKEYS.showHelp)).toBe(
      true,
    );
  });
});
