import React, { useEffect, useRef } from 'react';
import { ClipboardDocumentIcon } from '@heroicons/react/24/solid';
import { getSessionTemplate } from '../../../shared/sessionTemplates';
import { pinStateOnScroll, scrollTopForAnswer } from '../scrollPin';
import type { QaItem, SessionTemplateId } from '../types';

interface AnswerPanelProps {
  question: string;
  answer: string;
  streaming: boolean;
  history: QaItem[];
  detectorNote?: string;
  onAnswerNow: () => void;
  onCopy: () => void;
  autoDetect: boolean;
  onToggleAutoDetect: () => void;
  manualDraft: string;
  onManualDraft: (value: string) => void;
  onManualSubmit: () => void;
  questionInputRef: React.RefObject<HTMLTextAreaElement>;
  sessionTemplateId: SessionTemplateId;
  questionTimerSeconds: number;
  prepTimerSeconds: number;
  onQuestionTimerSeconds: (n: number) => void;
  onPrepTimerSeconds: (n: number) => void;
  timerRunId: number;
}

function formatMmSs(total: number): string {
  const s = Math.max(0, total);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

const AnswerPanel: React.FC<AnswerPanelProps> = ({
  question,
  answer,
  streaming,
  history,
  detectorNote,
  onAnswerNow,
  onCopy,
  autoDetect,
  onToggleAutoDetect,
  manualDraft,
  onManualDraft,
  onManualSubmit,
  questionInputRef,
  sessionTemplateId,
  questionTimerSeconds,
  prepTimerSeconds,
  onQuestionTimerSeconds,
  onPrepTimerSeconds,
  timerRunId,
}) => {
  const template = getSessionTemplate(sessionTemplateId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const wasStreaming = useRef(false);
  const remainingRef = useRef(0);
  const phaseRef = useRef<'idle' | 'prep' | 'answer'>('idle');
  const [, setTick] = React.useState(0);

  useEffect(() => {
    const started = streaming && !wasStreaming.current;
    wasStreaming.current = streaming;
    const top = scrollTopForAnswer(pinnedRef.current, started);
    if (started) pinnedRef.current = true;
    if (top != null && scrollRef.current) scrollRef.current.scrollTop = top;
  }, [streaming]);

  useEffect(() => {
    const top = scrollTopForAnswer(pinnedRef.current, false);
    if (top != null && scrollRef.current) scrollRef.current.scrollTop = top;
  }, [answer]);

  useEffect(() => {
    if (!template.timer.enabled || timerRunId === 0) {
      phaseRef.current = 'idle';
      remainingRef.current = 0;
      return;
    }
    const prep = prepTimerSeconds > 0 ? prepTimerSeconds : 0;
    phaseRef.current = prep > 0 ? 'prep' : 'answer';
    remainingRef.current = prep > 0 ? prep : questionTimerSeconds;
    setTick((n) => n + 1);
    const id = window.setInterval(() => {
      remainingRef.current -= 1;
      if (remainingRef.current <= 0 && phaseRef.current === 'prep') {
        phaseRef.current = 'answer';
        remainingRef.current = questionTimerSeconds;
      } else if (remainingRef.current <= 0) {
        remainingRef.current = 0;
        window.clearInterval(id);
      }
      setTick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunId, template.timer.enabled, prepTimerSeconds, questionTimerSeconds]);

  const onManualKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onManualSubmit();
    }
  };

  return (
    <section className="flex flex-col h-[50vh] md:h-[calc(100vh-12rem)] bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-indigo-100 dark:border-indigo-900">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-indigo-700 dark:text-indigo-300">AI Answer</h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={autoDetect}
            onClick={onToggleAutoDetect}
            className={`px-3 py-1.5 text-sm rounded-full ${
              autoDetect ? 'bg-green-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100'
            }`}
            title="Toggle Jev auto-detect"
          >
            Auto-detect {autoDetect ? 'On' : 'Off'}
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-200"
            title="Copy latest answer"
          >
            <ClipboardDocumentIcon className="h-4 w-4" />
            Copy
          </button>
          <button
            type="button"
            onClick={onAnswerNow}
            disabled={streaming}
            className="px-3 py-1.5 text-sm rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Answer now
          </button>
        </div>
      </div>

      {template.timer.enabled ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 text-sm">
          <label className="text-gray-600 dark:text-gray-300">
            Speak
            <select
              className="ml-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
              value={questionTimerSeconds}
              onChange={(e) => onQuestionTimerSeconds(Number(e.target.value))}
            >
              {template.timer.options.map((n) => (
                <option key={n} value={n}>
                  {n / 60} min
                </option>
              ))}
            </select>
          </label>
          {template.timer.prepOptions.some((n) => n > 0) ? (
            <label className="text-gray-600 dark:text-gray-300">
              Prep
              <select
                className="ml-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
                value={prepTimerSeconds}
                onChange={(e) => onPrepTimerSeconds(Number(e.target.value))}
              >
                {template.timer.prepOptions.map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'Off' : `${n}s`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {phaseRef.current !== 'idle' ? (
            <span className={`ml-auto font-mono ${remainingRef.current <= 10 && phaseRef.current === 'answer' ? 'text-red-600' : 'text-indigo-700 dark:text-indigo-300'}`}>
              {phaseRef.current === 'prep' ? 'Prep' : 'Record'} {formatMmSs(remainingRef.current)}
            </span>
          ) : (
            <span className="ml-auto text-gray-400 font-mono">{prepTimerSeconds > 0 ? `Prep ${formatMmSs(prepTimerSeconds)} · ` : ''}{formatMmSs(questionTimerSeconds)}</span>
          )}
        </div>
      ) : null}

      <div className={`px-4 pt-3 ${template.prominentManualInput ? 'pb-1' : 'pb-2'}`}>
        <label className="block text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
          {template.prominentManualInput ? 'On-screen question' : 'Type a question'}
        </label>
        <textarea
          ref={questionInputRef}
          value={manualDraft}
          onChange={(e) => onManualDraft(e.target.value)}
          onKeyDown={onManualKey}
          rows={template.prominentManualInput ? 4 : 2}
          className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
          placeholder={template.manualPlaceholder}
        />
        <p className="mt-1 text-xs text-gray-400">Enter to answer · Shift+Enter for a newline</p>
      </div>

      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          pinnedRef.current = pinStateOnScroll(el.scrollTop);
        }}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {detectorNote && <p className="text-xs text-gray-500 dark:text-gray-400">{detectorNote}</p>}
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{template.questionLabel}</p>
          <p className="mt-1 text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
            {question || template.emptyQuestion}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {template.kind === 'meeting' ? 'Brief' : 'Answer'} {streaming ? '(streaming)' : ''}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-gray-800 dark:text-gray-200 min-h-[4rem]">
            {answer || (streaming ? '…' : '')}
          </p>
        </div>

        {history.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Previous</p>
            <ul className="space-y-3">
              {history.map((item) => (
                <li key={item.id} className="text-sm bg-gray-50 dark:bg-gray-700 rounded p-3">
                  <p className="font-medium text-indigo-700 dark:text-indigo-300 whitespace-pre-wrap">{item.question}</p>
                  <p className="mt-1 whitespace-pre-wrap text-gray-700 dark:text-gray-200">{item.answer}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
};

export default AnswerPanel;
