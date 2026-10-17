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
import { QaItem, RecordingSession, TranscriptEntry, TranscriptionRecord, SessionTemplateId, UserSettings } from './types';
import { ThemeProvider } from './contexts/ThemeContext';
import { SettingsService } from './services/settings';
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

const App: React.FC = () => {
  const settingsService = SettingsService.getInstance();
  const [settings, setSettings] = useState<UserSettings>(settingsService.getSettings());
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

  const speechRef = useRef<SpeechController | null>(null);
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
  transcriptsRef.current = transcripts;
  const aiAnswerPanelRef = useRef(settings.showAiAnswer);
  const prevShowAiAnswerRef = useRef(settings.showAiAnswer);
  const ignoreUntilFinalSigRef = useRef<string | null>(null);
  const answerAbortRef = useRef<AbortController | null>(null);
  const answerGenerationRef = useRef(0);

  const detector: QuestionDetector = useMemo(
    () => createDebouncedDetector(new HttpQuestionDetector(), 400),
    [],
  );

  const saveTranscriptsToHistory = useCallback(() => {
    const currentSessionId = localStorage.getItem('currentSessionId');
    if (!currentSessionId) return;

    const storedHistory = localStorage.getItem('transcriptionHistory');
    const history: RecordingSession[] = storedHistory ? JSON.parse(storedHistory) : [];
    const existingSessionIndex = history.findIndex((session) => session.sessionId === currentSessionId);
    const finalTranscripts = transcriptsRef.current.filter((t) => t.isFinal);
    if (finalTranscripts.length === 0) return;

    const existingContent = new Set(history.flatMap((session) => session.transcriptions.map((t) => t.originalText)));
    const transcriptsToSave: TranscriptionRecord[] = finalTranscripts
      .filter((t) => !existingContent.has(t.original))
      .map((t) => ({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        timestamp: t.timestamp || new Date().toISOString(),
        originalText: t.original,
        translatedTexts: t.translations,
        sourceLanguage: t.sourceLanguage || settings.inputLanguage,
        targetLanguages: [settings.outputLanguage, settings.secondOutputLanguage].filter((lang): lang is string =>
          Boolean(lang),
        ),
      }));

    if (transcriptsToSave.length === 0) return;

    if (existingSessionIndex !== -1) {
      history[existingSessionIndex].transcriptions = [
        ...history[existingSessionIndex].transcriptions,
        ...transcriptsToSave,
      ];
    } else {
      history.unshift({
        sessionId: currentSessionId,
        timestamp: new Date().toISOString(),
        transcriptions: transcriptsToSave,
      });
    }
    localStorage.setItem('transcriptionHistory', JSON.stringify(history));
  }, [settings.inputLanguage, settings.outputLanguage, settings.secondOutputLanguage]);

  useEffect(() => {
    const hasUnsavedFinalTranscript = transcripts.some((t) => t.isFinal && !t.isSaved);
    if (hasUnsavedFinalTranscript) saveTranscriptsToHistory();
    if (!isRecording && transcripts.length > 0) saveTranscriptsToHistory();
    window.addEventListener('beforeunload', saveTranscriptsToHistory);
    return () => window.removeEventListener('beforeunload', saveTranscriptsToHistory);
  }, [isRecording, transcripts, saveTranscriptsToHistory]);

  useEffect(() => {
    speechRef.current = new SpeechController({
      onRecognizing: (original, translations, detectedLanguage) => {
        setTranscripts((prev) => {
          const updated = [...prev];
          const interimIndex = updated.findIndex((t) => !t.isFinal);
          const entry: TranscriptEntry = {
            original,
            translations: translations || [],
            isFinal: false,
            timestamp: new Date().toISOString(),
            sourceLanguage: detectedLanguage || settings.inputLanguage,
            targetLanguage: settings.outputLanguage,
          };
          if (interimIndex !== -1) updated[interimIndex] = entry;
          else updated.push(entry);
          return updated;
        });
      },
      onRecognized: (original, translations, detectedLanguage) => {
        setTranscripts((prev) => {
          const updated = [...prev];
          const interimIndex = updated.findIndex((t) => !t.isFinal);
          const entry: TranscriptEntry = {
            original,
            translations: translations || [],
            isFinal: true,
            isSaved: false,
            timestamp: interimIndex !== -1 ? updated[interimIndex].timestamp : new Date().toISOString(),
            sourceLanguage: detectedLanguage || settings.inputLanguage,
            targetLanguage: settings.outputLanguage,
          };
          if (interimIndex !== -1) updated[interimIndex] = entry;
          else if (!updated.some((t) => t.original === original && t.isFinal)) updated.push(entry);
          return updated;
        });
      },
      onError: (message) => {
        setError(message);
        setIsRecording(false);
      },
      onNotice: (message) => setError(message),
    });
    return () => {
      void speechRef.current?.stop();
    };
  }, [settings.inputLanguage, settings.outputLanguage]);

  useEffect(() => {
    void fetchPublicConfig()
      .then((cfg) => {
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
  }, [settingsService]);

  const sessionFinals = useCallback((): WindowSegment[] => {
    return transcriptsRef.current
      .filter((t) => t.isFinal && t.original.trim())
      .map((t, index) => ({ index, text: t.original, timestamp: t.timestamp }));
  }, []);

  const windowedSegments = useCallback(
    (extendFromIndex?: number | null) => {
      return windowForDetect(
        sessionFinals(),
        Date.now(),
        settings.answerWindowSeconds,
        DETECT_MAX_WORDS,
        extendFromIndex,
      );
    },
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
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      settingsService.updateSettings(partial);
      return next;
    });
  }, [settingsService]);

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
          });
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
          const extractSegs = windowedSegments(startId);
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
          });
          if (start.segmentIndex != null && Number.isFinite(start.segmentIndex)) bStart = start.segmentIndex;
        } catch {
          bStart = null;
        }
        if (!aiAnswerPanelRef.current) return;
        if (generation !== answerGenerationRef.current) return;
        const startId = resolveExtractStart(bStart, lastAnsweredEndIdRef.current, newestId);
        const extractSegs = windowedSegments(startId);
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
    [clearSilenceTimer, runAnswer, windowedSegments, sessionFinals, settings.answerWindowSeconds, settings.questionThreshold],
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
    if (!speechRef.current) return;
    if (!isRecording) {
      try {
        localStorage.setItem('currentSessionId', Date.now().toString());
        await speechRef.current.start(
          {
            inputLanguage: settings.inputLanguage,
            outputLanguage: settings.outputLanguage,
            secondOutputLanguage: settings.secondOutputLanguage,
          },
          settings.speechEngine,
        );
        setIsRecording(true);
        setError(null);
      } catch (err) {
        setError('Failed to start recording. Please check your microphone access.');
        console.error('Error starting recording:', err);
        localStorage.removeItem('currentSessionId');
      }
    } else {
      try {
        setIsRecording(false);
        await speechRef.current.stop();
        await new Promise((resolve) => setTimeout(resolve, 100));
        saveTranscriptsToHistory();
        localStorage.removeItem('currentSessionId');
      } catch (err) {
        setError('Failed to stop recording.');
        console.error('Error stopping recording:', err);
      }
    }
  };

  const handleClearTranscripts = () => {
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
    const languageChanged =
      next.inputLanguage !== settings.inputLanguage ||
      next.outputLanguage !== settings.outputLanguage ||
      next.secondOutputLanguage !== settings.secondOutputLanguage ||
      next.speechEngine !== settings.speechEngine;
    setSettings(next);
    settingsService.updateSettings(next);
    if (languageChanged && isRecording) {
      void handleToggleRecording();
    }
  };

  const copyLatest = async () => {
    const text = currentAnswer || qaHistory[0]?.answer || '';
    if (!text) return;
    await navigator.clipboard.writeText(text);
  };

  const cycleLayout = () => {
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
    <ThemeProvider>
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
            <History />
          )}
        </main>

        {isSettingsOpen && (
          <Settings
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            initialSettings={settings}
            onUpdate={handleSettingsUpdate}
          />
        )}
        <ShortcutHelp open={helpOpen} hotkeys={settings.hotkeys} onClose={() => setHelpOpen(false)} />
      </div>
    </ThemeProvider>
  );
};

export default App;
