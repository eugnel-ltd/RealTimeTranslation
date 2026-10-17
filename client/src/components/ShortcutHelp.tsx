import React from 'react';
import { formatHotkey, HOTKEY_LABELS, type HotkeyAction, type HotkeyMap } from '../hotkeys';

interface ShortcutHelpProps {
  open: boolean;
  hotkeys: HotkeyMap;
  onClose: () => void;
}

const ShortcutHelp: React.FC<ShortcutHelpProps> = ({ open, hotkeys, onClose }) => {
  if (!open) return null;
  const actions = Object.keys(HOTKEY_LABELS) as HotkeyAction[];
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-indigo-700 dark:text-indigo-300">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} className="text-gray-500">
            Close
          </button>
        </div>
        <ul className="space-y-2 text-sm">
          {actions.map((action) => (
            <li key={action} className="flex justify-between gap-4">
              <span className="text-gray-700 dark:text-gray-300">{HOTKEY_LABELS[action]}</span>
              <kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                {formatHotkey(hotkeys[action])}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-gray-500">Shortcuts are ignored while typing in a field. Press ? to toggle this help.</p>
      </div>
    </div>
  );
};

export default ShortcutHelp;
