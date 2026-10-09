import config from '../config';
import { DEFAULT_HOTKEYS } from '../hotkeys';
import type { UserSettings } from '../types';

const STORAGE_KEY = 'user_settings';

export class SettingsService {
  private static instance: SettingsService;
  private currentSettings: UserSettings;

  private constructor() {
    const savedSettings = localStorage.getItem(STORAGE_KEY);
    this.currentSettings = savedSettings
      ? { ...this.getDefaultSettings(), ...JSON.parse(savedSettings), hotkeys: { ...DEFAULT_HOTKEYS, ...(JSON.parse(savedSettings).hotkeys ?? {}) } }
      : this.getDefaultSettings();
  }

  public static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService();
    }
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
      answerWindowSeconds: 60,
      answerModel: 'claude-opus-5-5',
      answerLanguage: 'same',
      userContext: '',
      cvBackground: '',
      questionThreshold: 0.7,
      hotkeys: { ...DEFAULT_HOTKEYS },
    };
  }

  public getSettings(): UserSettings {
    return {
      ...this.currentSettings,
      hotkeys: { ...DEFAULT_HOTKEYS, ...this.currentSettings.hotkeys },
    };
  }

  public updateSettings(newSettings: Partial<UserSettings>): UserSettings {
    this.currentSettings = {
      ...this.currentSettings,
      ...newSettings,
      hotkeys: { ...this.currentSettings.hotkeys, ...(newSettings.hotkeys ?? {}) },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentSettings));
    return this.getSettings();
  }

  public resetToDefaults(): UserSettings {
    this.currentSettings = this.getDefaultSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentSettings));
    return this.getSettings();
  }
}
