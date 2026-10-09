import type { SessionTemplateId } from '../../shared/sessionTemplates';
import type { HotkeyMap } from './hotkeys';

export interface TranscriptEntry {
  original: string;
  translations: string[];
  isFinal: boolean;
  timestamp?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  isSaved?: boolean;
}

export interface TranscriptionRecord {
  id: string;
  timestamp: string;
  originalText: string;
  translatedTexts: string[];
  sourceLanguage: string;
  targetLanguages: string[];
}

export interface RecordingSession {
  sessionId: string;
  timestamp: string;
  transcriptions: TranscriptionRecord[];
}

export type SpeechEngineMode = 'auto' | 'azure' | 'gemini-translator' | 'gemini-live-translate';
export type SplitLayout = 'transcript-left' | 'transcript-right' | 'transcript-top' | 'transcript-bottom';
export type AnswerLanguage = 'same' | 'en' | 'yue' | 'zh-CN';
export type AnswerModel = 'claude-opus-5-5' | 'claude-sonnet-5-5';
export type AnswerWindowSeconds = 30 | 60;
export type CandidateProfileId = '' | 'james' | 'wing';

export interface QaItem {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export interface UserSettings {
  inputLanguage: string;
  outputLanguage: string;
  secondOutputLanguage: string;
  theme: 'light' | 'dark';
  speechEngine: SpeechEngineMode;
  splitLayout: SplitLayout;
  answerWindowSeconds: AnswerWindowSeconds;
  answerModel: AnswerModel;
  answerLanguage: AnswerLanguage;
  userContext: string;
  extraNotes: string;
  profileId: CandidateProfileId;
  questionThreshold: number;
  sessionTemplateId: SessionTemplateId;
  autoDetect: boolean;
  questionTimerSeconds: number;
  prepTimerSeconds: number;
  hotkeys: HotkeyMap;
}

export type { SessionTemplateId };

export type { HotkeyMap };
