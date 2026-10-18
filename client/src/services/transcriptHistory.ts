import type { RecordingSession, TranscriptEntry, TranscriptionRecord } from '../types';
import { isObject, readStoredJson, writeStoredJson } from './browserStorage';

const HISTORY_KEY = 'transcriptionHistory';

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is TranscriptionRecord {
  return isObject(value) &&
    typeof value.id === 'string' && value.id.length > 0 &&
    isTimestamp(value.timestamp) &&
    typeof value.originalText === 'string' &&
    isStringArray(value.translatedTexts) &&
    typeof value.sourceLanguage === 'string' &&
    isStringArray(value.targetLanguages);
}

function parseHistory(value: unknown): RecordingSession[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((session) => {
    if (!isObject(session) || typeof session.sessionId !== 'string' || !session.sessionId ||
        !isTimestamp(session.timestamp) || !Array.isArray(session.transcriptions)) return [];
    return [{
      sessionId: session.sessionId,
      timestamp: session.timestamp,
      transcriptions: session.transcriptions.filter(isRecord),
    }];
  });
}

export function loadTranscriptHistory(): RecordingSession[] {
  return parseHistory(readStoredJson(HISTORY_KEY).value);
}

/** Empty result means nothing was durably saved; the caller retains its retry queue. */
export function persistTranscriptEntries(entries: TranscriptEntry[]): string[] {
  if (entries.length === 0) return [];
  const stored = readStoredJson(HISTORY_KEY);
  if (!stored.available) return [];
  const history = parseHistory(stored.value);
  const sessions = new Map(history.map((session) => [session.sessionId, session]));
  const recordIds = new Map<string, Set<string>>();
  const savedIds: string[] = [];
  let changed = false;
  for (const entry of entries) {
    if (!entry.isFinal) continue;
    let session = sessions.get(entry.sessionId);
    if (!session) {
      session = { sessionId: entry.sessionId, timestamp: entry.sessionTimestamp, transcriptions: [] };
      sessions.set(entry.sessionId, session);
      history.unshift(session);
    }
    let ids = recordIds.get(entry.sessionId);
    if (!ids) {
      ids = new Set(session.transcriptions.map((record) => record.id));
      recordIds.set(entry.sessionId, ids);
    }
    if (!ids.has(entry.id)) {
      session.transcriptions.push({
        id: entry.id,
        timestamp: entry.timestamp || entry.sessionTimestamp,
        originalText: entry.original,
        translatedTexts: [...entry.translations],
        sourceLanguage: entry.sourceLanguage || '',
        targetLanguages: [...entry.targetLanguages],
      });
      ids.add(entry.id);
      changed = true;
    }
    savedIds.push(entry.id);
  }
  return !changed || writeStoredJson(HISTORY_KEY, history) ? savedIds : [];
}

/** Leave the displayed sessions intact when the requested deletion cannot be saved. */
export function deleteTranscriptSession(sessionId: string): RecordingSession[] | null {
  const stored = readStoredJson(HISTORY_KEY);
  if (!stored.available) return null;
  const history = parseHistory(stored.value).filter((session) => session.sessionId !== sessionId);
  return writeStoredJson(HISTORY_KEY, history) ? history : null;
}

let nextId = 0;
export function createTranscriptId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++nextId}-${Math.random().toString(36).slice(2)}`;
}
