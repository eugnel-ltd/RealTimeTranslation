import React, { useRef, useEffect } from 'react';
import { TranscriptEntry } from '../types';
import { motion, AnimatePresence } from 'framer-motion';
import config from '../config';

interface TranscriptBoxProps {
  transcripts: TranscriptEntry[];
  outputLanguage: string;
  secondOutputLanguage?: string;
  className?: string;
}

const getLanguageDisplayName = (code: string): string => {
  const language = config.languages.find(lang => lang.code === code);
  return language?.nativeName || code;
};

const TranscriptBox: React.FC<TranscriptBoxProps> = ({ 
  transcripts, 
  outputLanguage, 
  secondOutputLanguage,
  className,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  const languages = [outputLanguage, secondOutputLanguage].filter((lang): lang is string => Boolean(lang));

  return (
    <div ref={scrollRef} className={`p-4 sm:p-6 overflow-y-auto bg-white dark:bg-gray-800 transition-colors duration-300 ${className ?? 'h-[calc(100vh-12rem)]'}`}>
      <AnimatePresence>
        {transcripts.map((entry, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="mb-6 last:mb-0 bg-gray-50 dark:bg-gray-700 p-4 rounded-lg shadow-sm"
          >
            <div className="text-lg font-semibold text-indigo-700 dark:text-indigo-300 mb-2">{entry.original}</div>
            {entry.translations.map((text, i) => (
              <div key={i} className="mt-2">
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  {getLanguageDisplayName(languages[i])}:
                </span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{text}</span>
              </div>
            ))}
          </motion.div>
        ))}
      </AnimatePresence>
      {transcripts.length === 0 && (
        <div className="text-center text-gray-500 dark:text-gray-400 mt-20">
          No transcripts yet. Start recording to see translations.
        </div>
      )}
    </div>
  );
};

export default TranscriptBox;
