import { parseShowAiAnswer } from '../../../shared/aiAnswerPanel';
import {
  coerceDetectWindowSeconds,
  DEFAULT_QUESTION_THRESHOLD,
} from '../../../shared/extractWindow';
import {
  applyTemplateDefaults,
  getSessionTemplate,
  isSessionTemplateId,
  PREP_TIMER_OPTIONS,
  QUESTION_TIMER_OPTIONS,
} from '../../../shared/sessionTemplates';
import config, { isValidLanguage } from '../config';
import { DEFAULT_HOTKEYS } from '../hotkeys';
import type { UserSettings } from '../types';
import { isObject, readStoredJson, writeStoredJson } from './browserStorage';

const STORAGE_KEY = 'user_settings';

export class SettingsService {
  private static instance: SettingsService;
  private currentSettings: UserSettings;

  private constructor() {
    this.currentSettings = this.normalize(readStoredJson(STORAGE_KEY).value);
  }

  public static getInstance(): SettingsService {
    if (!SettingsService.instance) SettingsService.instance = new SettingsService();
    return SettingsService.instance;
  }

  private getDefaultSettings(): UserSettings {
    return {
      inputLanguage: config.defaultSettings.inputLanguage,
      outputLanguage: config.defaultSettings.outputLanguage,
      secondOutputLanguage: config.defaultSettings.secondOutputLanguage,
      theme: config.ui.defaultTheme as 'light' | 'dark',
      speechEngine: 'auto',
      splitLayout: 'transcript-left',
      answerWindowSeconds: 120,
      answerModel: 'gemini-3.8-flash',
      answerLanguage: 'same',
      userContext: '',
      extraNotes: '',
      saveTranscriptHistory: false,
      profileId: '',
      questionThreshold: DEFAULT_QUESTION_THRESHOLD,
      ...applyTemplateDefaults(undefined),
      autoDetect: true,
      showAiAnswer: getSessionTemplate(undefined).defaultShowAiAnswer !== false,
      hotkeys: { ...DEFAULT_HOTKEYS },
    };
  }

  private normalize(value: unknown): UserSettings {
    const parsed = isObject(value) ? value : {};
    const defaults = this.getDefaultSettings();
    const sessionTemplateId = typeof parsed.sessionTemplateId === 'string' && isSessionTemplateId(parsed.sessionTemplateId)
      ? parsed.sessionTemplateId : defaults.sessionTemplateId;
    const tpl = getSessionTemplate(sessionTemplateId);
    const hotkeys = { ...DEFAULT_HOTKEYS };
    if (isObject(parsed.hotkeys)) {
      for (const key of Object.keys(hotkeys) as (keyof typeof hotkeys)[]) {
        const shortcut = parsed.hotkeys[key];
        if (typeof shortcut === 'string' && shortcut.trim()) hotkeys[key] = shortcut;
      }
    }
    const language = (value: unknown, fallback: string, allowEmpty = false, allowAuto = false) =>
      typeof value === 'string' && isValidLanguage(value) &&
      (allowEmpty || value !== '') && (allowAuto || value !== 'auto') ? value : fallback;
    return {
      inputLanguage: language(parsed.inputLanguage, defaults.inputLanguage, false, true),
      outputLanguage: language(parsed.outputLanguage, defaults.outputLanguage),
      secondOutputLanguage: language(parsed.secondOutputLanguage, defaults.secondOutputLanguage, true),
      theme: choose(parsed.theme, ['light', 'dark'], defaults.theme),
      speechEngine: choose(parsed.speechEngine, ['auto', 'azure', 'gemini-translator', 'gemini-live-translate'], defaults.speechEngine),
      splitLayout: choose(parsed.splitLayout, ['transcript-left', 'transcript-right', 'transcript-top', 'transcript-bottom'], defaults.splitLayout),
      answerModel: choose(parsed.answerModel, ['gemini-3.8-flash', 'gemini-3.5-flash-lite'], defaults.answerModel),
      answerLanguage: choose(parsed.answerLanguage, ['same', 'en', 'yue', 'zh-CN'], defaults.answerLanguage),
      userContext: typeof parsed.userContext === 'string' ? parsed.userContext : '',
      extraNotes: typeof parsed.extraNotes === 'string' ? parsed.extraNotes :
        typeof parsed.cvBackground === 'string' ? parsed.cvBackground : '',
      saveTranscriptHistory: parsed.saveTranscriptHistory === true,
      profileId: choose(parsed.profileId, ['', 'james', 'wing'], defaults.profileId),
      sessionTemplateId,
      autoDetect: typeof parsed.autoDetect === 'boolean' ? parsed.autoDetect : true,
      showAiAnswer: parseShowAiAnswer(parsed.showAiAnswer, tpl.defaultShowAiAnswer !== false),
      answerWindowSeconds: coerceDetectWindowSeconds(parsed.answerWindowSeconds),
      questionThreshold:
        typeof parsed.questionThreshold === 'number' && Number.isFinite(parsed.questionThreshold) &&
        parsed.questionThreshold >= 0 && parsed.questionThreshold <= 1
          ? parsed.questionThreshold : DEFAULT_QUESTION_THRESHOLD,
      questionTimerSeconds: pickAllowed(parsed.questionTimerSeconds, [0, ...QUESTION_TIMER_OPTIONS], tpl.timer.enabled ? tpl.timer.defaultSeconds : 0),
      prepTimerSeconds: pickAllowed(parsed.prepTimerSeconds, [...PREP_TIMER_OPTIONS], tpl.timer.prepDefaultSeconds),
      hotkeys,
    };
  }

  public getSettings(): UserSettings {
    return { ...this.currentSettings, hotkeys: { ...this.currentSettings.hotkeys } };
  }

  public updateSettings(newSettings: Partial<UserSettings>): UserSettings {
    const previousHistoryChoice = this.currentSettings.saveTranscriptHistory;
    this.currentSettings = this.normalize({
      ...this.currentSettings,
      ...newSettings,
      hotkeys: { ...this.currentSettings.hotkeys, ...(newSettings.hotkeys ?? {}) },
    });
    const saved = writeStoredJson(STORAGE_KEY, this.currentSettings);
    if (!saved && previousHistoryChoice !== this.currentSettings.saveTranscriptHistory) {
      throw new Error('History choice could not be saved. It applies until this page reloads. Clear this site’s browser data to remove an earlier choice.');
    }
    return this.getSettings();
  }

  public resetToDefaults(): UserSettings {
    this.currentSettings = this.getDefaultSettings();
    writeStoredJson(STORAGE_KEY, this.currentSettings);
    return this.getSettings();
  }
}

function pickAllowed(value: unknown, allowed: readonly number[], fallback: number): number {
  return typeof value === 'number' && allowed.includes(value) ? value : fallback;
}

function choose<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}
