import React, { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/solid';
import { motion, AnimatePresence } from 'framer-motion';
import config from '../config';
import { HOTKEY_LABELS, formatHotkey, shortcutFromEvent, type HotkeyAction } from '../hotkeys';
import type {
  AnswerLanguage,
  AnswerModel,
  AnswerWindowSeconds,
  SpeechEngineMode,
  SplitLayout,
  UserSettings,
} from '../types';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  initialSettings: UserSettings;
  onUpdate: (settings: UserSettings) => void;
}

const getLanguageDisplayName = (lang: (typeof config.languages)[number]): string => {
  if (lang.code.startsWith('en')) return lang.name;
  return `${lang.name} (${lang.nativeName})`;
};

const Settings: React.FC<SettingsProps> = ({ isOpen, onClose, initialSettings, onUpdate }) => {
  const [draft, setDraft] = useState<UserSettings>(initialSettings);
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null);

  useEffect(() => {
    setDraft(initialSettings);
  }, [initialSettings]);

  const handleSave = () => {
    onUpdate(draft);
    onClose();
  };

  const patch = (partial: Partial<UserSettings>) => setDraft((prev) => ({ ...prev, ...partial }));

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-xl shadow-xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-indigo-700 dark:text-indigo-300">Settings</h2>
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors duration-300"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Input Language
                </label>
                <select
                  value={draft.inputLanguage}
                  onChange={(e) => patch({ inputLanguage: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {config.languages
                    .filter((lang) => lang.code !== '')
                    .map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {getLanguageDisplayName(lang)}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Primary Translation Language
                </label>
                <select
                  value={draft.outputLanguage}
                  onChange={(e) => patch({ outputLanguage: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {config.languages
                    .filter((lang) => lang.code !== '')
                    .map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {getLanguageDisplayName(lang)}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Secondary Translation Language (Optional)
                </label>
                <select
                  value={draft.secondOutputLanguage}
                  onChange={(e) => patch({ secondOutputLanguage: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {config.languages.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.code === '' ? 'None' : getLanguageDisplayName(lang)}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="border border-gray-200 dark:border-gray-600 rounded-md p-3 space-y-3">
                <legend className="px-1 text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                  Speech engine
                </legend>
                <select
                  value={draft.speechEngine}
                  onChange={(e) => patch({ speechEngine: e.target.value as SpeechEngineMode })}
                  className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  <option value="auto">Auto (Azure, fall back on quota)</option>
                  <option value="azure">Azure only</option>
                  <option value="gemini-translator">Gemini + Translator</option>
                  <option value="gemini-live-translate">Gemini Live translate</option>
                </select>
              </fieldset>

              <fieldset className="border border-gray-200 dark:border-gray-600 rounded-md p-3 space-y-3">
                <legend className="px-1 text-sm font-semibold text-indigo-700 dark:text-indigo-300">AI Answer</legend>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Split layout
                  </label>
                  <select
                    value={draft.splitLayout}
                    onChange={(e) => patch({ splitLayout: e.target.value as SplitLayout })}
                    className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="transcript-left">Left / right (transcript left)</option>
                    <option value="transcript-right">Left / right (transcript right)</option>
                    <option value="transcript-top">Top / bottom (transcript top)</option>
                    <option value="transcript-bottom">Top / bottom (transcript bottom)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Conversation window
                  </label>
                  <select
                    value={draft.answerWindowSeconds}
                    onChange={(e) => patch({ answerWindowSeconds: Number(e.target.value) as AnswerWindowSeconds })}
                    className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value={30}>30 seconds</option>
                    <option value={60}>60 seconds</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Model</label>
                  <select
                    value={draft.answerModel}
                    onChange={(e) => patch({ answerModel: e.target.value as AnswerModel })}
                    className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="claude-opus-5-5">claude-opus-5-5</option>
                    <option value="claude-sonnet-5-5">claude-sonnet-5-5</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Answer language
                  </label>
                  <select
                    value={draft.answerLanguage}
                    onChange={(e) => patch({ answerLanguage: e.target.value as AnswerLanguage })}
                    className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="same">Same as question</option>
                    <option value="en">English</option>
                    <option value="yue">Cantonese</option>
                    <option value="zh-CN">Mandarin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Question detector threshold ({draft.questionThreshold.toFixed(2)})
                  </label>
                  <input
                    type="range"
                    min={0.5}
                    max={0.95}
                    step={0.05}
                    value={draft.questionThreshold}
                    onChange={(e) => patch({ questionThreshold: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Context about me / the role
                  </label>
                  <textarea
                    value={draft.userContext}
                    onChange={(e) => patch({ userContext: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    placeholder="Experience, target role, constraints…"
                  />
                </div>
              </fieldset>

              <fieldset className="border border-gray-200 dark:border-gray-600 rounded-md p-3 space-y-2">
                <legend className="px-1 text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                  Keyboard shortcuts
                </legend>
                {(Object.keys(HOTKEY_LABELS) as HotkeyAction[]).map((action) => (
                  <div key={action} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{HOTKEY_LABELS[action]}</span>
                    <button
                      type="button"
                      onClick={() => setCapturing(action)}
                      onKeyDown={(e) => {
                        if (capturing !== action) return;
                        e.preventDefault();
                        e.stopPropagation();
                        patch({ hotkeys: { ...draft.hotkeys, [action]: shortcutFromEvent(e) } });
                        setCapturing(null);
                      }}
                      className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700"
                    >
                      {capturing === action ? 'Press a key…' : formatHotkey(draft.hotkeys[action])}
                    </button>
                  </div>
                ))}
              </fieldset>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default Settings;
