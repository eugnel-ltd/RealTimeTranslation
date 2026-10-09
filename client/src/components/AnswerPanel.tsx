import React, { useEffect, useRef } from 'react';
import { ClipboardDocumentIcon } from '@heroicons/react/24/solid';
import type { QaItem } from '../types';

interface AnswerPanelProps {
  question: string;
  answer: string;
  streaming: boolean;
  history: QaItem[];
  detectorNote?: string;
  onAnswerNow: () => void;
  onCopy: () => void;
}

const AnswerPanel: React.FC<AnswerPanelProps> = ({
  question,
  answer,
  streaming,
  history,
  detectorNote,
  onAnswerNow,
  onCopy,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [answer, history.length]);

  return (
    <section className="flex flex-col h-[50vh] md:h-[calc(100vh-12rem)] bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-indigo-100 dark:border-indigo-900">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-indigo-700 dark:text-indigo-300">AI Answer</h2>
        <div className="flex gap-2">
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {detectorNote && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{detectorNote}</p>
        )}
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Detected question</p>
          <p className="mt-1 text-gray-900 dark:text-gray-100">{question || 'Waiting for an interview question…'}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Answer {streaming ? '(streaming)' : ''}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-gray-800 dark:text-gray-200 min-h-[4rem]">
            {answer || (streaming ? '…' : '')}
          </p>
        </div>

        {history.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Previous Q&As</p>
            <ul className="space-y-3">
              {history.map((item) => (
                <li key={item.id} className="text-sm bg-gray-50 dark:bg-gray-700 rounded p-3">
                  <p className="font-medium text-indigo-700 dark:text-indigo-300">{item.question}</p>
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
