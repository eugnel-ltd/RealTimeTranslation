import React, { useState, useEffect } from 'react';
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from '@heroicons/react/24/solid';
import { RecordingSession } from '../types';
import { deleteTranscriptSession, loadTranscriptHistory } from '../services/transcriptHistory';

interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  sessionDate: string;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ isOpen, onConfirm, onCancel, sessionDate }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm w-full mx-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
          Confirm Delete
        </h3>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Are you sure you want to delete the recording session from {sessionDate}?
        </p>
        <div className="flex justify-end space-x-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

const History: React.FC = () => {
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    sessionId: string;
    sessionDate: string;
  }>({
    isOpen: false,
    sessionId: '',
    sessionDate: ''
  });

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = () => {
    const history = loadTranscriptHistory();
    history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setSessions(history);
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const formatDate = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const handleDeleteClick = (e: React.MouseEvent, sessionId: string, timestamp: string) => {
    e.stopPropagation();
    setDeleteConfirm({
      isOpen: true,
      sessionId,
      sessionDate: formatDate(timestamp)
    });
  };

  const handleDeleteConfirm = () => {
    const history = deleteTranscriptSession(deleteConfirm.sessionId);
    if (history) {
      history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setSessions(history);
    }
    setDeleteConfirm({ isOpen: false, sessionId: '', sessionDate: '' });
  };

  const handleDeleteCancel = () => {
    setDeleteConfirm({ isOpen: false, sessionId: '', sessionDate: '' });
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4">
      <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-gray-200">Recording History</h2>
      {sessions.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">No recording history available</p>
      ) : (
        <div className="space-y-4">
          {sessions.map((session) => (
            <div
              key={session.sessionId}
              className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800 shadow-sm"
            >
              <div className="flex justify-between items-center p-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                <button
                  onClick={() => toggleExpand(session.sessionId)}
                  className="flex-1 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1 transition-colors"
                >
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(session.timestamp)}
                    </p>
                    <p className="text-gray-800 dark:text-gray-200 mt-1">
                      {session.transcriptions.length} transcription{session.transcriptions.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  {expandedId === session.sessionId ? (
                    <ChevronUpIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                  ) : (
                    <ChevronDownIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                  )}
                </button>
                <button
                  onClick={(e) => handleDeleteClick(e, session.sessionId, session.timestamp)}
                  className="ml-4 p-2 text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title="Delete recording"
                >
                  <TrashIcon className="h-5 w-5" />
                </button>
              </div>
              
              {expandedId === session.sessionId && (
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {session.transcriptions.map((record) => (
                    <div 
                      key={record.id} 
                      className="p-4 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            Original Text ({record.sourceLanguage})
                          </h3>
                          <p className="mt-1 text-gray-800 dark:text-gray-200">{record.originalText}</p>
                        </div>
                        {record.translatedTexts.map((text, index) => (
                          <div key={index}>
                            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                              Translation ({record.targetLanguages[index]})
                            </h3>
                            <p className="mt-1 text-gray-800 dark:text-gray-200">{text}</p>
                          </div>
                        ))}
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(record.timestamp)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        sessionDate={deleteConfirm.sessionDate}
      />
    </div>
  );
};

export default History;
