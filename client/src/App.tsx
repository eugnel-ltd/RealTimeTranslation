import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header';
import TranscriptBox from './components/TranscriptBox';
import Settings from './components/Settings';
import History from './components/History';
import AnswerPanel from './components/AnswerPanel';
import ShortcutHelp from './components/ShortcutHelp';
import { QaItem, RecordingSession, TranscriptEntry, TranscriptionRecord, UserSettings } from './types';
import { ThemeProvider } from './contexts/ThemeContext';
import { SettingsService } from './services/settings';
import { SpeechController } from './services/speechController';
import { fetchPublicConfig, streamAnswer } from './services/api';
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

  const speechRef = useRef<SpeechController | null>(null);
  const lastAnsweredRef = useRef<string | null>(null);
  const answeringRef = useRef(false);
  const transcriptsRef = useRef(transcripts);
  transcriptsRef.current = transcripts;

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
        if (cfg.defaultAnswerModel === 'claude-opus-5-5' || cfg.defaultAnswerModel === 'claude-sonnet-5-5') {
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

  const windowedSegments = useCallback(() => {
    const cutoff = Date.now() - settings.answerWindowSeconds * 1000;
    return transcriptsRef.current
      .filter((t) => t.isFinal && t.original.trim())
      .filter((t) => new Date(t.timestamp || 0).getTime() >= cutoff)
      .map((t, index) => ({ index, text: t.original, timestamp: t.timestamp }));
  }, [settings.answerWindowSeconds]);

  const conversationText = useCallback(() => {
    return windowedSegments()
      .map((s) => s.text)
      .join('\n');
  }, [windowedSegments]);

  const runAnswer = useCallback(
    async (opts: { question?: string; force: boolean }) => {
      if (answeringRef.current) return;
      const conversation = conversationText();
      if (!conversation && !opts.question) return;
      answeringRef.current = true;
      setStreaming(true);
      setCurrentAnswer('');
      if (opts.question) setCurrentQuestion(opts.question);
      let assembled = '';
      let question = opts.question ?? '';
      try {
        await streamAnswer(
          {
            conversation,
            question: opts.question,
            previousQuestion: lastAnsweredRef.current ?? undefined,
            answerLanguage: settings.answerLanguage,
            userContext: settings.userContext,
            cvBackground: settings.cvBackground,
            model: settings.answerModel,
            force: opts.force,
          },
          (event, data) => {
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
            if (event === 'error') {
              setError(String(data.error ?? 'Answer stream error'));
            }
          },
        );
        if (question && assembled.trim()) {
          lastAnsweredRef.current = question;
          setQaHistory((prev) =>
            [
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                question,
                answer: assembled.trim(),
                createdAt: new Date().toISOString(),
              },
              ...prev,
            ].slice(0, 20),
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Answer failed');
      } finally {
        answeringRef.current = false;
        setStreaming(false);
      }
    },
    [conversationText, settings.answerLanguage, settings.answerModel, settings.userContext, settings.cvBackground],
  );

  useEffect(() => {
    const finals = transcripts.filter((t) => t.isFinal);
    if (!isRecording || finals.length === 0) return;
    const latest = finals[finals.length - 1];
    if (!latest.original.trim()) return;
    let cancelled = false;
    void detector
      .detect({
        segments: windowedSegments(),
        windowSeconds: settings.answerWindowSeconds,
        lastAnsweredQuestion: lastAnsweredRef.current,
        threshold: settings.questionThreshold,
      })
      .then((result) => {
        if (cancelled) return;
        setDetectorNote(
          result.detector === 'jev'
            ? `Jev p=${result.probability?.toFixed(2) ?? '—'}`
            : `Detector: ${result.detector}`,
        );
        if (result.shouldAnswer && result.question && result.question !== lastAnsweredRef.current) {
          void runAnswer({ question: result.question, force: false });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [transcripts, isRecording, detector, settings.answerWindowSeconds, settings.questionThreshold, windowedSegments, runAnswer]);

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

  const handleClearTranscripts = () => setTranscripts([]);

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
      } else if (eventMatchesHotkey(event, hk.answerNow)) {
        event.preventDefault();
        void runAnswer({ force: true });
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
        void copyLatest();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const layoutClass = {
    'transcript-left': 'flex flex-col md:flex-row',
    'transcript-right': 'flex flex-col md:flex-row-reverse',
    'transcript-top': 'flex flex-col',
    'transcript-bottom': 'flex flex-col-reverse',
  }[settings.splitLayout];

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
        />

        <main className="container mx-auto px-4 py-8">
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
              {error}
            </div>
          )}

          {activeTab === 'transcription' ? (
            <div className={`${layoutClass} gap-4`}>
              <div className="flex-1 min-w-0">
                <TranscriptBox
                  transcripts={transcripts}
                  outputLanguage={settings.outputLanguage}
                  secondOutputLanguage={settings.secondOutputLanguage}
                  className="h-[50vh] md:h-[calc(100vh-12rem)] rounded-lg"
                />
              </div>
              <div className="flex-1 min-w-0">
                <AnswerPanel
                  question={currentQuestion}
                  answer={currentAnswer}
                  streaming={streaming}
                  history={qaHistory}
                  detectorNote={detectorNote}
                  onAnswerNow={() => void runAnswer({ force: true })}
                  onCopy={() => void copyLatest()}
                />
              </div>
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
