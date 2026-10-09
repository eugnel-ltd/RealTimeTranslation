import React, { useRef, useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/solid';
import { motion, AnimatePresence } from 'framer-motion';
import config from '../config';
import { applyTemplateDefaults, getSessionTemplate } from '../../../shared/sessionTemplates';
import { getProfile, listProfiles, putProfile, type ProfileSummary } from '../services/api';
import { HOTKEY_LABELS, formatHotkey, shortcutFromEvent, type HotkeyAction } from '../hotkeys';
import type {
  AnswerLanguage,
  AnswerModel,
  AnswerWindowSeconds,
  CandidateProfileId,
  SessionTemplateId,
  SpeechEngineMode,
  SplitLayout,
  UserSettings,
} from '../types';
import SessionTemplateSelect from './SessionTemplateSelect';

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

const SEED_PROFILES: ProfileSummary[] = [
  { id: 'james', name: 'James' },
  { id: 'wing', name: 'Wing' },
];

const Settings: React.FC<SettingsProps> = ({ isOpen, onClose, initialSettings, onUpdate }) => {
  const [draft, setDraft] = useState<UserSettings>(initialSettings);
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null);
  const [profiles, setProfiles] = useState<ProfileSummary[]>(SEED_PROFILES);
  const [editorName, setEditorName] = useState('');
  const [editorMarkdown, setEditorMarkdown] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [profileNote, setProfileNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(initialSettings);
  }, [initialSettings]);

  useEffect(() => {
    if (!isOpen) return;
    void listProfiles()
      .then((data) => setProfiles(data.profiles.length ? data.profiles : SEED_PROFILES))
      .catch(() => setProfiles(SEED_PROFILES));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !draft.profileId) {
      setEditorName('');
      setEditorMarkdown('');
      setEditorDirty(false);
      return;
    }
    let cancelled = false;
    const id = draft.profileId;
    void getProfile(id)
      .then((p) => {
        if (cancelled) return;
        setEditorName(p.name);
        setEditorMarkdown(p.markdown);
        setEditorDirty(false);
        setProfileNote('');
      })
      .catch((err) => {
        if (!cancelled) setProfileNote(err instanceof Error ? err.message : 'Failed to load profile');
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, draft.profileId]);

  const saveProfile = async () => {
    if (!draft.profileId) return;
    const saved = await putProfile(draft.profileId, { name: editorName, markdown: editorMarkdown });
    setEditorDirty(false);
    setProfileNote(`Saved ${saved.bytes} bytes to ${saved.name}`);
    setProfiles((prev) => prev.map((p) => (p.id === saved.id ? { id: saved.id, name: saved.name } : p)));
  };

  const handleSave = async () => {
    try {
      if (draft.profileId && editorDirty) await saveProfile();
      onUpdate(draft);
      onClose();
    } catch (err) {
      setProfileNote(err instanceof Error ? err.message : 'Failed to save profile');
    }
  };

  const onUpload = async (file: File) => {
    if (!/\.(md|txt)$/i.test(file.name)) {
      setProfileNote('Upload a .md or .txt file');
      return;
    }
    const text = await file.text();
    if (new TextEncoder().encode(text).length > 200 * 1024) {
      setProfileNote('File exceeds 200KB');
      return;
    }
    setEditorMarkdown(text);
    setEditorDirty(true);
    setProfileNote(`Loaded ${file.name}`);
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
                    Session type
                  </label>
                  <SessionTemplateSelect
                    value={draft.sessionTemplateId}
                    onChange={(id: SessionTemplateId) => patch(applyTemplateDefaults(id))}
                    className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {getSessionTemplate(draft.sessionTemplateId).description}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={draft.autoDetect}
                    onChange={(e) => patch({ autoDetect: e.target.checked })}
                  />
                  Auto-detect questions (Jev)
                </label>
                {getSessionTemplate(draft.sessionTemplateId).timer.enabled ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Answer timer
                      </label>
                      <select
                        value={draft.questionTimerSeconds}
                        onChange={(e) => patch({ questionTimerSeconds: Number(e.target.value) })}
                        className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      >
                        {getSessionTemplate(draft.sessionTemplateId).timer.options.map((n) => (
                          <option key={n} value={n}>
                            {n / 60} min
                          </option>
                        ))}
                      </select>
                    </div>
                    {getSessionTemplate(draft.sessionTemplateId).timer.prepOptions.some((n) => n > 0) ? (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Prep timer
                        </label>
                        <select
                          value={draft.prepTimerSeconds}
                          onChange={(e) => patch({ prepTimerSeconds: Number(e.target.value) })}
                          className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        >
                          {getSessionTemplate(draft.sessionTemplateId).timer.prepOptions.map((n) => (
                            <option key={n} value={n}>
                              {n === 0 ? 'Off' : `${n}s`}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                ) : null}
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
                    Candidate profile
                  </label>
                  <select
                    value={draft.profileId}
                    onChange={(e) => patch({ profileId: e.target.value as CandidateProfileId })}
                    className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="">None</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                {draft.profileId ? (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Profile markdown (stored in KV, not in this repo)
                    </label>
                    <input
                      value={editorName}
                      onChange={(e) => {
                        setEditorName(e.target.value);
                        setEditorDirty(true);
                      }}
                      className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      placeholder="Display name"
                    />
                    <textarea
                      value={editorMarkdown}
                      onChange={(e) => {
                        setEditorMarkdown(e.target.value);
                        setEditorDirty(true);
                      }}
                      rows={10}
                      className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-mono text-sm"
                      placeholder="Paste or upload CV / background markdown…"
                    />
                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".md,.txt,text/markdown,text/plain"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file) void onUpload(file);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="px-3 py-1 text-sm rounded-md bg-gray-100 dark:bg-gray-700"
                      >
                        Upload .md / .txt
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveProfile().catch((err) => setProfileNote(err instanceof Error ? err.message : 'Save failed'))}
                        className="px-3 py-1 text-sm rounded-md bg-indigo-600 text-white"
                      >
                        Save profile
                      </button>
                    </div>
                    {profileNote ? <p className="text-xs text-gray-500 dark:text-gray-400">{profileNote}</p> : null}
                  </div>
                ) : null}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Context about me / the role
                  </label>
                  <textarea
                    value={draft.userContext}
                    onChange={(e) => patch({ userContext: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    placeholder="Target role, constraints, what to emphasise…"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Extra notes (override)
                  </label>
                  <textarea
                    value={draft.extraNotes}
                    onChange={(e) => patch({ extraNotes: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    placeholder="Session-only notes on top of the selected profile…"
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
