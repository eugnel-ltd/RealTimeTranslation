import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header';
import TranscriptBox from './components/TranscriptBox';
import Settings from './components/Settings';
import History from './components/History';
import AnswerPanel from './components/AnswerPanel';
import ShortcutHelp from './components/ShortcutHelp';
import { planAutoAnswer, resolveExtractStart } from '../../shared/autoAnswer';
import {
  DETECT_MAX_WORDS,
  generousCutoffMs,
  joinSegmentText,
  segmentsAfterCutoff,
  sliceFromQuestionStart,
  TAIL_WATCH_MS,
  windowForDetect,
  windowForExtract,
  type WindowSegment,
} from '../../shared/extractWindow';
import { confirmSilence, createDetectGateState, nextDetectGate } from './detectors/detectGate';
import {
  onShowAiAnswerChange,
  shouldRunQuestionDetect,
  splitContainerClass,
  transcriptPaneClass,
} from '../../shared/aiAnswerPanel';
import { applyTemplateDefaults, getSessionTemplate } from '../../shared/sessionTemplates';
import { QaItem, TranscriptEntry, SessionTemplateId, UserSettings } from './types';
import { LegalFooter } from './components/LegalFooter';
import { ThemeProvider } from './contexts/ThemeContext';
import { SettingsService } from './services/settings';
import type { AppRuntime } from './services/accountLifetime';
import { createTranscriptId, persistTranscriptEntries } from './services/transcriptHistory';
import { SpeechController } from './services/speechController';
import { detectQuestion, fetchPublicConfig, streamAnswer } from './services/api';
import { createDebouncedDetector, HttpQuestionDetector } from './detectors/httpDetector';
import type { QuestionDetector } from './detectors/types';
import { eventMatchesHotkey, isTypingTarget } from './hotkeys';

const LAYOUT_CYCLE: UserSettings['splitLayout'][] = [
  'transcript-left',
  'transcript-right',
  'transcript-top',
  'transcript-bottom',
];

type RecordingOperation = {
  controller: SpeechController | null;
  generation: number;
  sessionId: string;
  timestamp: string;
  active: boolean;
  used: boolean;
};

const App: React.FC<{ runtime?: AppRuntime; accountControls?: React.ReactNode }> = ({ runtime, accountControls }) => {
  const settingsService = useMemo(() => runtime ? SettingsService.forStorage(runtime.storage) : SettingsService.getInstance(), [runtime]);
  const [settings, setSettings] = useState<UserSettings>(() => settingsService.getSettings());
  const [isRecording, setIsRecording] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'transcription' | 'history'>('transcription');
  const [helpOpen, setHelpOpen] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [qaHistory, setQaHistory] = useState<QaItem[]>([]);
  const [detectorNote, setDetectorNote] = useState<string>();
  const [manualDraft, setManualDraft] = useState('');
  const [timerRunId, setTimerRunId] = useState(0);

  const recordingRef = useRef<RecordingOperation | null>(null);
  const recordingGenerationRef = useRef(0);
  const pendingTranscriptsRef = useRef(new Map<string, TranscriptEntry>());
  const historyEnabledRef = useRef(settings.saveTranscriptHistory === true);
  // This scopes received transcript results, not the provider's audio start time.
  const historyConsentGenerationRef = useRef(0);
  const lastAnsweredRef = useRef<string | null>(null);
  const lastAnsweredAtRef = useRef<number | null>(null);
  const lastAnsweredStartIdRef = useRef<number | null>(null);
  const lastAnsweredEndIdRef = useRef<number | null>(null);
  const lastHintRef = useRef<string | null>(null);
  const lastConversationRef = useRef<string | null>(null);
  const answeringRef = useRef(false);
  const detectGateRef = useRef(createDetectGateState());
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAutoRef = useRef<{ hint: string; newestId: number | null }>({ hint: '', newestId: null });
  const tailUntilRef = useRef(0);
  const tailStartIdRef = useRef<number | null>(null);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptsRef = useRef(transcripts);
  const aiAnswerPanelRef = useRef(settings.showAiAnswer);
  const prevShowAiAnswerRef = useRef(settings.showAiAnswer);
  const ignoreUntilFinalSigRef = useRef<string | null>(null);
  const answerAbortRef = useRef<AbortController | null>(null);
  const answerGenerationRef = useRef(0);

  const detector: QuestionDetector = useMemo(
    () => createDebouncedDetector(new HttpQuestionDetector(runtime), 400),
    [runtime],
  );

  const saveTranscriptsToHistory = useCallback(() => {
    if (runtime && !runtime.active) return;
    if (!historyEnabledRef.current) return;
    if (pendingTranscriptsRef.current.size === 0) return;
    const savedIds = new Set(persistTranscriptEntries([...pendingTranscriptsRef.current.values()], runtime?.storage));
    if (savedIds.size === 0) return;
    for (const id of savedIds) pendingTranscriptsRef.current.delete(id);
    const updated = transcriptsRef.current.map((entry) =>
      savedIds.has(entry.id) && !entry.isSaved ? { ...entry, isSaved: true } : entry,
    );
    transcriptsRef.current = updated;
    setTranscripts(updated);
  }, [runtime]);

  useEffect(() => {
    saveTranscriptsToHistory();
  }, [isRecording, transcripts, saveTranscriptsToHistory]);

  useEffect(() => {
    window.addEventListener('beforeunload', saveTranscriptsToHistory);
    return () => window.removeEventListener('beforeunload', saveTranscriptsToHistory);
  }, [saveTranscriptsToHistory]);

  const stopRecording = useCallback(async () => {
    const operation = recordingRef.current;
    if (!operation) return;
    // Invalidate synchronously, before awaiting the provider or accepting another start.
    operation.active = false;
    recordingRef.current = null;
    const generation = ++recordingGenerationRef.current;
    setIsRecording(false);
    saveTranscriptsToHistory();
    try {
      await operation.controller?.stop();
      saveTranscriptsToHistory();
    } catch {
      if (generation === recordingGenerationRef.current && (!runtime || runtime.active)) setError('Failed to stop recording.');
    }
  }, [saveTranscriptsToHistory]);

  const createRecordingOperation = useCallback(() => {
    const operation: RecordingOperation = {
      controller: null,
      generation: ++recordingGenerationRef.current,
      sessionId: createTranscriptId(),
      timestamp: new Date().toISOString(),
      active: false,
      used: false,
    };
    // Every controller belongs to one session and one immutable set of speech settings.
    const isCurrent = () => (!runtime || runtime.active) && operation.active &&
      recordingRef.current === operation &&
      recordingGenerationRef.current === operation.generation;
    const receiveTranscript = (
      original: string, translations: string[], detectedLanguage: string | undefined, isFinal: boolean,
    ) => {
      if (!isCurrent()) return;
      const newId = createTranscriptId();
      const timestamp = new Date().toISOString();
      const updated = [...transcriptsRef.current];
      const interimIndex = updated.findIndex((entry) => !entry.isFinal && entry.sessionId === operation.sessionId);
      const interim = interimIndex === -1 ? undefined : updated[interimIndex];
      const entry: TranscriptEntry = {
        id: interim?.id ?? newId,
        sessionId: operation.sessionId,
        sessionTimestamp: operation.timestamp,
        original,
        translations: translations || [],
        isFinal,
        isSaved: false,
        historyConsentGeneration: interim?.historyConsentGeneration ?? historyConsentGenerationRef.current,
        timestamp: interim?.timestamp ?? timestamp,
        sourceLanguage: detectedLanguage || settings.inputLanguage,
        targetLanguage: settings.outputLanguage,
        targetLanguages: [settings.outputLanguage, settings.secondOutputLanguage].filter(Boolean),
      };
      if (interimIndex !== -1) updated[interimIndex] = entry;
      else updated.push(entry);
      if (isFinal && historyEnabledRef.current && entry.historyConsentGeneration === historyConsentGenerationRef.current) {
        pendingTranscriptsRef.current.set(entry.id, entry);
      }
      // Publish the ref and retry queue synchronously so an immediate Stop cannot lose a final
      // while React is batching the corresponding render.
      transcriptsRef.current = updated;
      setTranscripts(updated);
    };
    operation.controller = new SpeechController({
      onRecognizing: (original, translations, detectedLanguage) =>
        receiveTranscript(original, translations, detectedLanguage, false),
      onRecognized: (original, translations, detectedLanguage) =>
        receiveTranscript(original, translations, detectedLanguage, true),
      onError: (message) => {
        if (!isCurrent()) return;
        setError(message);
        void stopRecording();
      },
      onNotice: (message) => {
        if (isCurrent()) setError(message);
      },
    }, runtime);
    return operation;
  }, [settings.inputLanguage, settings.outputLanguage, settings.secondOutputLanguage, stopRecording, runtime]);

  useEffect(() => {
    recordingRef.current = createRecordingOperation();
    setIsRecording(false);
    return () => {
      const operation = recordingRef.current;
      recordingRef.current = null;
      ++recordingGenerationRef.current;
      if (operation) {
        operation.active = false;
        void operation.controller?.stop().catch(() => undefined);
      }
    };
  }, [createRecordingOperation, settings.speechEngine]);

  useEffect(() => {
    void fetchPublicConfig(runtime)
      .then((cfg) => {
        if (runtime && !runtime.active) return;
        if (cfg.defaultAnswerModel === 'gemini-3.8-flash' || cfg.defaultAnswerModel === 'gemini-3.5-flash-lite') {
          setSettings((prev) => {
            if (prev.answerModel) return prev;
            const next = { ...prev, answerModel: cfg.defaultAnswerModel as UserSettings['answerModel'] };
            settingsService.updateSettings({ answerModel: next.answerModel });
            return next;
          });
        }
      })
      .catch(() => undefined);
  }, [settingsService, runtime]);

  const sessionFinals = useCallback((): WindowSegment[] => {
    return transcriptsRef.current
      .filter((t) => t.isFinal && t.original.trim())
      .map((t, index) => ({ index, text: t.original, timestamp: t.timestamp }));
  }, []);

  const windowedSegments = useCallback(
    () => {
      return windowForDetect(
        sessionFinals(),
        Date.now(),
        settings.answerWindowSeconds,
        DETECT_MAX_WORDS,
      );
    },
    [sessionFinals, settings.answerWindowSeconds],
  );

  const extractionSegments = useCallback(
    (startIndex?: number | null) => windowForExtract(
      sessionFinals(),
      Date.now(),
      settings.answerWindowSeconds,
      startIndex,
      lastAnsweredAtRef.current,
    ),
    [sessionFinals, settings.answerWindowSeconds],
  );

  const finalSig = useMemo(() => {
    const f = transcripts.filter((t) => t.isFinal && t.original.trim());
    const last = f[f.length - 1];
    return `${f.length}|${last?.original ?? ''}|${last?.timestamp ?? ''}`;
  }, [transcripts]);

  const conversationText = useCallback(() => {
    return windowedSegments()
      .map((s) => s.text)
      .join('\n');
  }, [windowedSegments]);

  const patchSettings = useCallback((partial: Partial<UserSettings>) => {
    if (runtime && !runtime.active) return;
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      settingsService.updateSettings(partial);
      return next;
    });
  }, [settingsService, runtime]);

  const runAnswer = useCallback(
    async (opts: {
      question?: string;
      conversation?: string;
      hint?: string;
      force: boolean;
      source: 'auto' | 'manual-button' | 'manual-text';
      replace?: boolean;
      startId?: number | null;
      endId?: number | null;
    }) => {
      if (runtime && !runtime.active) return;
      if (!aiAnswerPanelRef.current) return;
      if (answeringRef.current && !opts.replace) return;
      const generation = answerGenerationRef.current;
      const template = getSessionTemplate(settings.sessionTemplateId);
      let conversation = opts.conversation ?? conversationText();
      let question = (opts.question ?? '').trim();
      let extractQuestion = false;
      const hint = opts.hint?.trim() || '';

      if (opts.source === 'manual-text') {
        question = (opts.question ?? manualDraft).trim();
        if (!question) return;
      }

      if (opts.source === 'auto') {
        question = '';
        extractQuestion = true;
        if (!conversation) return;
      }

      if (opts.source === 'manual-button' && !question) {
        const now = Date.now();
        const cutoff = generousCutoffMs(now, template.manualExtractWindowSeconds, lastAnsweredAtRef.current);
        const numbered = transcriptsRef.current
          .filter((t) => t.isFinal && t.original.trim())
          .map((t, index) => ({ index, text: t.original, timestamp: t.timestamp }));
        let segs = segmentsAfterCutoff(numbered, cutoff).map((s, index) => ({ ...s, index }));
        try {
          const start = await detectQuestion({
            mode: 'question-start',
            segments: segs,
            windowSeconds: template.manualExtractWindowSeconds,
            lastAnsweredQuestion: lastAnsweredRef.current,
            threshold: settings.questionThreshold,
          }, runtime);
          if (generation !== answerGenerationRef.current) return;
          segs = sliceFromQuestionStart(segs, start.segmentIndex);
          setDetectorNote(
            start.detector === 'jev' && start.segmentIndex != null
              ? `Extract window from segment ${start.segmentIndex}`
              : 'Full extract window (Jev start unavailable)',
          );
        } catch {
          if (generation !== answerGenerationRef.current) return;
          setDetectorNote('Full extract window (Jev start unavailable)');
        }
        if (!aiAnswerPanelRef.current) return;
        conversation = joinSegmentText(segs);
        extractQuestion = true;
      }

      if (!conversation && !question) return;
      if (!aiAnswerPanelRef.current) return;
      answeringRef.current = true;
      setStreaming(true);
      setTimerRunId((n) => n + 1);
      setCurrentAnswer('');
      if (question) setCurrentQuestion(question);
      else if (extractQuestion) setCurrentQuestion('');
      let assembled = '';
      let completed = false;
      let failed = false;
      answerAbortRef.current?.abort();
      const abort = new AbortController();
      answerAbortRef.current = abort;
      try {
        await streamAnswer(
          {
            conversation,
            question: question || undefined,
            questionHint: extractQuestion && hint ? hint : undefined,
            previousQuestion: lastAnsweredRef.current ?? undefined,
            answerLanguage: settings.answerLanguage,
            userContext: settings.userContext,
            extraNotes: settings.extraNotes,
            profileId: settings.profileId || undefined,
            model: settings.answerModel,
            force: opts.force,
            templateId: settings.sessionTemplateId,
            extractQuestion,
            questionTimeLimitSeconds: settings.questionTimerSeconds || undefined,
          },
          (event, data) => {
            if (abort.signal.aborted || generation !== answerGenerationRef.current || !aiAnswerPanelRef.current) return;
            if (event === 'skip') {
              setDetectorNote('No new interview question since the last answer.');
              return;
            }
            if (event === 'question') {
              question = String(data.question ?? '');
              setCurrentQuestion(question);
            }
            if (event === 'token') {
              assembled += String(data.text ?? '');
              setCurrentAnswer(assembled);
            }
            if (event === 'done') completed = true;
            if (event === 'error') {
              failed = true;
              setError(String(data.error ?? 'Answer stream error'));
            }
          },
          abort.signal,
          runtime,
        );
        if (abort.signal.aborted || generation !== answerGenerationRef.current || !aiAnswerPanelRef.current) return;
        if (!completed || failed) return;
        if (question && assembled.trim()) {
          lastAnsweredRef.current = question;
          lastAnsweredAtRef.current = Date.now();
          if (opts.startId != null) lastAnsweredStartIdRef.current = opts.startId;
          if (opts.endId != null) lastAnsweredEndIdRef.current = opts.endId;
          if (hint) lastHintRef.current = hint;
          if (extractQuestion) lastConversationRef.current = conversation;
          if (opts.source === 'manual-text') setManualDraft('');
          setQaHistory((prev) => {
            const item = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              question,
              answer: assembled.trim(),
              createdAt: new Date().toISOString(),
            };
            if (opts.replace && prev[0]) return [{ ...prev[0], question, answer: item.answer }, ...prev.slice(1)].slice(0, 20);
            return [item, ...prev].slice(0, 20);
          });
        }
      } catch (err) {
        if (abort.signal.aborted || generation !== answerGenerationRef.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Answer failed');
      } finally {
        if (answerAbortRef.current === abort) {
          answeringRef.current = false;
          setStreaming(false);
        }
      }
    },
    [
      conversationText,
      manualDraft,
      settings.answerLanguage,
      settings.answerModel,
      settings.userContext,
      settings.extraNotes,
      settings.profileId,
      settings.sessionTemplateId,
      settings.questionThreshold,
      settings.questionTimerSeconds,
      runtime,
    ],
  );

  const answerNow = useCallback(() => {
    if (!aiAnswerPanelRef.current) return;
    const typed = manualDraft.trim();
    if (typed) {
      void runAnswer({ question: typed, force: true, source: 'manual-text' });
      return;
    }
    void runAnswer({ force: true, source: 'manual-button' });
  }, [manualDraft, runAnswer]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    ++answerGenerationRef.current;
    detector.cancel?.();
    clearSilenceTimer();
    const abort = answerAbortRef.current;
    answerAbortRef.current = null;
    answeringRef.current = false;
    abort?.abort();
  }, [detector, clearSilenceTimer]);

  useEffect(() => runtime?.onRevoke(() => {
    historyEnabledRef.current = false;
    ++historyConsentGenerationRef.current;
    pendingTranscriptsRef.current.clear();
    ++recordingGenerationRef.current;
    const operation = recordingRef.current;
    recordingRef.current = null;
    if (operation) {
      operation.active = false;
      void operation.controller?.stop().catch(() => undefined);
    }
    ++answerGenerationRef.current;
    aiAnswerPanelRef.current = false;
    detector.cancel?.();
    clearSilenceTimer();
    const answer = answerAbortRef.current;
    answerAbortRef.current = null;
    answer?.abort();
    answeringRef.current = false;
    pendingAutoRef.current = { hint: '', newestId: null };
    lastAnsweredRef.current = null;
    lastHintRef.current = null;
    lastConversationRef.current = null;
    transcriptsRef.current = [];
    setIsRecording(false);
    setTranscripts([]);
    setQaHistory([]);
    setCurrentQuestion('');
    setCurrentAnswer('');
    setManualDraft('');
    setSettings((previous) => ({ ...previous, userContext: '', extraNotes: '', profileId: '' }));
    setDetectorNote(undefined);
    setStreaming(false);
    setIsSettingsOpen(false);
    setHelpOpen(false);
  }), [runtime, detector, clearSilenceTimer]);

  const fireAutoAnswer = useCallback(
    (hintFromHit: string, replace = false) => {
      if (!aiAnswerPanelRef.current) return;
      const generation = answerGenerationRef.current;
      clearSilenceTimer();
      void (async () => {
        if (!aiAnswerPanelRef.current) return;
        if (answeringRef.current && !replace) return;
        const all = sessionFinals();
        const newest = all.at(-1);
        const newestId = newest?.index ?? null;
        const newestHit = newest?.text.trim() || hintFromHit;

        if (replace) {
          const startId = tailStartIdRef.current;
          const extractSegs = extractionSegments(startId);
          const conversation = joinSegmentText(sliceFromQuestionStart(extractSegs, startId));
          if (!conversation || conversation === lastConversationRef.current) return;
          if (!aiAnswerPanelRef.current) return;
          if (newestId != null) lastAnsweredEndIdRef.current = newestId;
          setDetectorNote(startId != null ? `Extract window from segment ${startId}` : 'Full extract window (Jev start unavailable)');
          await runAnswer({
            force: true,
            source: 'auto',
            conversation,
            hint: newestHit,
            replace: true,
            startId,
            endId: newestId,
          });
          return;
        }

        const detectSegs = windowedSegments();
        let bStart: number | null = null;
        try {
          const start = await detectQuestion({
            mode: 'question-start',
            segments: detectSegs,
            windowSeconds: settings.answerWindowSeconds,
            lastAnsweredQuestion: lastAnsweredRef.current,
            threshold: settings.questionThreshold,
          }, runtime);
          if (start.segmentIndex != null && Number.isFinite(start.segmentIndex)) bStart = start.segmentIndex;
        } catch {
          bStart = null;
        }
        if (!aiAnswerPanelRef.current) return;
        if (generation !== answerGenerationRef.current) return;
        const startId = resolveExtractStart(bStart, lastAnsweredEndIdRef.current, newestId);
        const extractSegs = extractionSegments(startId);
        const plan = planAutoAnswer({
          windowSegments: extractSegs,
          startIndex: startId,
          hintText: newestHit,
          lastAnsweredEndId: lastAnsweredEndIdRef.current,
        });
        if (plan.skip) {
          if (plan.reason === 'repeat') setDetectorNote('No new interview question since the last answer.');
          return;
        }
        if (plan.startIndex != null) {
          lastAnsweredStartIdRef.current = plan.startIndex;
          tailStartIdRef.current = plan.startIndex;
        }
        if (plan.endIndex != null) lastAnsweredEndIdRef.current = plan.endIndex;
        tailUntilRef.current = Date.now() + TAIL_WATCH_MS;
        setDetectorNote(
          plan.startIndex != null
            ? `Extract window from segment ${plan.startIndex}`
            : 'Full extract window (Jev start unavailable)',
        );
        if (!aiAnswerPanelRef.current) return;
        await runAnswer({
          force: false,
          source: 'auto',
          conversation: plan.conversation,
          hint: plan.hint,
          startId: plan.startIndex,
          endId: plan.endIndex,
        });
      })();
    },
    [clearSilenceTimer, runAnswer, windowedSegments, extractionSegments, sessionFinals, settings.answerWindowSeconds, settings.questionThreshold, runtime],
  );

  useEffect(() => {
    if (!settings.showAiAnswer || !settings.autoDetect || !isRecording) {
      detectGateRef.current = createDetectGateState();
      pendingAutoRef.current = { hint: '', newestId: null };
      tailUntilRef.current = 0;
      clearSilenceTimer();
    }
  }, [settings.showAiAnswer, settings.autoDetect, isRecording, clearSilenceTimer]);

  useEffect(() => {
    aiAnswerPanelRef.current = settings.showAiAnswer;
    const prev = prevShowAiAnswerRef.current;
    if (prev === settings.showAiAnswer) return;
    prevShowAiAnswerRef.current = settings.showAiAnswer;
    const change = onShowAiAnswerChange(
      prev,
      settings.showAiAnswer,
      sessionFinals().at(-1)?.index ?? null,
      finalSig,
    );
    detector.cancel?.();
    if (change.resetGate) {
      detectGateRef.current = createDetectGateState();
      pendingAutoRef.current = { hint: '', newestId: null };
      tailUntilRef.current = 0;
      clearSilenceTimer();
    }
    ignoreUntilFinalSigRef.current = change.ignoreUntilFinalSig;
    if (change.latchEndId != null) lastAnsweredEndIdRef.current = change.latchEndId;
    if (!settings.showAiAnswer) {
      answerAbortRef.current?.abort();
      answeringRef.current = false;
      setStreaming(false);
    }
  }, [settings.showAiAnswer, sessionFinals, finalSig, detector, clearSilenceTimer]);

  useEffect(() => {
    const all = sessionFinals();
    if (
      !shouldRunQuestionDetect({
        showAiAnswer: settings.showAiAnswer,
        autoDetect: settings.autoDetect,
        isRecording,
        hasFinals: all.length > 0,
        finalSig,
        ignoreUntilFinalSig: ignoreUntilFinalSigRef.current,
      })
    ) {
      return;
    }
    const generation = answerGenerationRef.current;
    const newest = all[all.length - 1];
    const newestId = newest.index;
    if (Date.now() < tailUntilRef.current && tailStartIdRef.current != null && newestId > (lastAnsweredEndIdRef.current ?? -1)) {
      lastAnsweredEndIdRef.current = newestId;
      fireAutoAnswer(newest.text, true);
      return;
    }
    const segs = windowedSegments();
    void detector
      .detect({
        segments: segs,
        windowSeconds: settings.answerWindowSeconds,
        lastAnsweredQuestion: lastAnsweredRef.current,
        threshold: settings.questionThreshold,
      })
      .then((result) => {
        if (generation !== answerGenerationRef.current || !aiAnswerPanelRef.current) return;
        const hint = result.question?.trim() || newest.text.trim();
        const fingerprint = `a:${newestId}`;
        setDetectorNote(
          result.detector === 'jev'
            ? `Jev p=${result.probability?.toFixed(2) ?? '—'}`
            : `Detector: ${result.detector}${result.skippedReason ? ` (${result.skippedReason})` : ''}`,
        );
        const outcome = nextDetectGate(detectGateRef.current, {
          positive: Boolean(result.shouldAnswer),
          fingerprint,
          newestId,
          nowMs: Date.now(),
          finalCount: all.length,
          lastAnsweredEndId: lastAnsweredEndIdRef.current,
        });
        detectGateRef.current = outcome.state;
        if (outcome.fire) {
          fireAutoAnswer(hint);
          return;
        }
        if (outcome.scheduleSilenceMs == null) {
          return;
        }
        pendingAutoRef.current = { hint, newestId };
        if (silenceTimerRef.current) return;
        silenceTimerRef.current = setTimeout(() => {
          silenceTimerRef.current = null;
          if (generation !== answerGenerationRef.current || !aiAnswerPanelRef.current) return;
          const latest = sessionFinals().at(-1);
          const silent = confirmSilence(detectGateRef.current, {
            nowMs: Date.now(),
            newestId: latest?.index ?? newestId,
            lastAnsweredEndId: lastAnsweredEndIdRef.current,
          });
          detectGateRef.current = silent.state;
          if (silent.fire) fireAutoAnswer(pendingAutoRef.current.hint || latest?.text || '');
        }, outcome.scheduleSilenceMs);
      })
      .catch(() => undefined);
  }, [
    finalSig,
    isRecording,
    detector,
    settings.answerWindowSeconds,
    settings.questionThreshold,
    settings.autoDetect,
    settings.showAiAnswer,
    windowedSegments,
    sessionFinals,
    fireAutoAnswer,
  ]);

  const handleToggleRecording = async () => {
    if (runtime && !runtime.active) return;
    if (recordingRef.current?.active) {
      await stopRecording();
      return;
    }
    const operation = recordingRef.current?.used === false
      ? recordingRef.current : createRecordingOperation();
    if (!operation.controller) return;
    recordingRef.current = operation;
    operation.used = true;
    operation.active = true;
    operation.timestamp = new Date().toISOString();
    setError(null);
    try {
      await operation.controller.start(
        {
          inputLanguage: settings.inputLanguage,
          outputLanguage: settings.outputLanguage,
          secondOutputLanguage: settings.secondOutputLanguage,
        },
        settings.speechEngine,
      );
      if (recordingRef.current !== operation || !operation.active ||
          operation.generation !== recordingGenerationRef.current) return;
      setIsRecording(true);
    } catch {
      if (recordingRef.current !== operation || !operation.active ||
          operation.generation !== recordingGenerationRef.current) return;
      setError('Failed to start recording. Please check your microphone access.');
      await stopRecording();
    }
  };

  const handleClearTranscripts = () => {
    if (runtime && !runtime.active) return;
    saveTranscriptsToHistory();
    ++answerGenerationRef.current;
    detector.cancel?.();
    clearSilenceTimer();
    answerAbortRef.current?.abort();
    answerAbortRef.current = null;
    answeringRef.current = false;
    detectGateRef.current = createDetectGateState();
    pendingAutoRef.current = { hint: '', newestId: null };
    lastAnsweredRef.current = null;
    lastAnsweredAtRef.current = null;
    lastAnsweredStartIdRef.current = null;
    lastAnsweredEndIdRef.current = null;
    lastHintRef.current = null;
    lastConversationRef.current = null;
    tailUntilRef.current = 0;
    tailStartIdRef.current = null;
    ignoreUntilFinalSigRef.current = null;
    transcriptsRef.current = [];
    setTranscripts([]);
    setCurrentQuestion('');
    setCurrentAnswer('');
    setDetectorNote(undefined);
    setStreaming(false);
    setTimerRunId(0);
  };

  const handleSettingsUpdate = (next: UserSettings) => {
    if (runtime && !runtime.active) return;
    if (historyEnabledRef.current !== (next.saveTranscriptHistory === true)) historyConsentGenerationRef.current++;
    historyEnabledRef.current = next.saveTranscriptHistory === true;
    if (!historyEnabledRef.current) pendingTranscriptsRef.current.clear();
    const languageChanged =
      next.inputLanguage !== settings.inputLanguage ||
      next.outputLanguage !== settings.outputLanguage ||
      next.secondOutputLanguage !== settings.secondOutputLanguage ||
      next.speechEngine !== settings.speechEngine;
    if (languageChanged) void stopRecording();
    setSettings(next);
    settingsService.updateSettings(next);
  };

  const copyLatest = async () => {
    if (runtime && !runtime.active) return;
    const text = currentAnswer || qaHistory[0]?.answer || '';
    if (!text) return;
    await navigator.clipboard.writeText(text);
  };

  const cycleLayout = () => {
    if (runtime && !runtime.active) return;
    const idx = LAYOUT_CYCLE.indexOf(settings.splitLayout);
    const next = LAYOUT_CYCLE[(idx + 1) % LAYOUT_CYCLE.length];
    const updated = { ...settings, splitLayout: next };
    setSettings(updated);
    settingsService.updateSettings({ splitLayout: next });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.repeat) return;
      const hk = settings.hotkeys;
      if (eventMatchesHotkey(event, hk.showHelp) || event.key === '?') {
        event.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (isSettingsOpen || helpOpen) return;
      if (eventMatchesHotkey(event, hk.toggleRecording)) {
        event.preventDefault();
        void handleToggleRecording();
      } else if (eventMatchesHotkey(event, hk.toggleAiAnswer)) {
        event.preventDefault();
        patchSettings({ showAiAnswer: !settings.showAiAnswer });
      } else if (eventMatchesHotkey(event, hk.answerNow)) {
        event.preventDefault();
        if (settings.showAiAnswer) answerNow();
      } else if (eventMatchesHotkey(event, hk.toggleAutoDetect)) {
        event.preventDefault();
        patchSettings({ autoDetect: !settings.autoDetect });
      } else if (eventMatchesHotkey(event, hk.focusQuestionInput)) {
        event.preventDefault();
        if (settings.showAiAnswer) questionInputRef.current?.focus();
      } else if (eventMatchesHotkey(event, hk.clear)) {
        event.preventDefault();
        if (activeTab !== 'history') handleClearTranscripts();
      } else if (eventMatchesHotkey(event, hk.openSettings)) {
        event.preventDefault();
        if (activeTab !== 'history') setIsSettingsOpen(true);
      } else if (eventMatchesHotkey(event, hk.tabTranscription)) {
        event.preventDefault();
        setActiveTab('transcription');
      } else if (eventMatchesHotkey(event, hk.tabHistory)) {
        event.preventDefault();
        setActiveTab('history');
      } else if (eventMatchesHotkey(event, hk.toggleLayout)) {
        event.preventDefault();
        cycleLayout();
      } else if (eventMatchesHotkey(event, hk.copyAnswer)) {
        event.preventDefault();
        if (settings.showAiAnswer) void copyLatest();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <ThemeProvider settingsService={settingsService} runtime={runtime}>
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 transition-colors duration-300">
        <Header
          isRecording={isRecording}
          onToggleRecording={handleToggleRecording}
          onClearHistory={handleClearTranscripts}
          onOpenSettings={() => setIsSettingsOpen(true)}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          sessionTemplateId={settings.sessionTemplateId}
          onSessionTemplate={(id: SessionTemplateId) => patchSettings(applyTemplateDefaults(id))}
          showAiAnswer={settings.showAiAnswer}
          onToggleAiAnswer={() => patchSettings({ showAiAnswer: !settings.showAiAnswer })}
        />

        <main className="container mx-auto px-4 py-8">
          {accountControls}
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
              {error}
            </div>
          )}

          {activeTab === 'transcription' ? (
            <div className={splitContainerClass(settings.splitLayout, settings.showAiAnswer)}>
              <div className={settings.showAiAnswer ? 'flex-1 min-w-0' : 'w-full h-full'}>
                <TranscriptBox
                  transcripts={transcripts}
                  outputLanguage={settings.outputLanguage}
                  secondOutputLanguage={settings.secondOutputLanguage}
                  className={transcriptPaneClass(settings.showAiAnswer)}
                />
              </div>
              {settings.showAiAnswer ? (
                <div className="flex-1 min-w-0">
                  <AnswerPanel
                    question={currentQuestion}
                    answer={currentAnswer}
                    streaming={streaming}
                    history={qaHistory}
                    detectorNote={detectorNote}
                    onAnswerNow={answerNow}
                    onCopy={() => void copyLatest()}
                    autoDetect={settings.autoDetect}
                    onToggleAutoDetect={() => patchSettings({ autoDetect: !settings.autoDetect })}
                    manualDraft={manualDraft}
                    onManualDraft={setManualDraft}
                    onManualSubmit={() => {
                      const typed = manualDraft.trim();
                      if (typed) void runAnswer({ question: typed, force: true, source: 'manual-text' });
                    }}
                    questionInputRef={questionInputRef}
                    sessionTemplateId={settings.sessionTemplateId}
                    questionTimerSeconds={settings.questionTimerSeconds}
                    prepTimerSeconds={settings.prepTimerSeconds}
                    onQuestionTimerSeconds={(n) => patchSettings({ questionTimerSeconds: n })}
                    onPrepTimerSeconds={(n) => patchSettings({ prepTimerSeconds: n })}
                    timerRunId={timerRunId}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <History storage={runtime?.storage} />
          )}
        </main>

        <LegalFooter />

        {isSettingsOpen && (
          <Settings
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            initialSettings={settings}
            onUpdate={handleSettingsUpdate}
            runtime={runtime}
          />
        )}
        <ShortcutHelp open={helpOpen} hotkeys={settings.hotkeys} onClose={() => setHelpOpen(false)} />
      </div>
    </ThemeProvider>
  );
};

export default App;
