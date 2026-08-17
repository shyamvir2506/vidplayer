import React from 'react';

const STEP_ICONS = {
  'Extracting audio': '🔊',
  'Transcribing':     '📝',
  'Translating':      '🌐',
  'Generating Hindi': '🎙️',
  'Assembling':       '🔧',
  'Uploading':        '⬆️'
};

function getStepIcon(message = '') {
  for (const [key, icon] of Object.entries(STEP_ICONS)) {
    if (message.toLowerCase().includes(key.toLowerCase())) return icon;
  }
  return '⚙️';
}

export default function DubbingStatus({ status, onRetry }) {
  if (!status) return null;

  const { status: state, progress = 0, message = '', debug } = status;

  return (
    <div className={`dubbing-status status-${state}`}>
      {state === 'processing' && (
        <>
          <div className="status-header">
            <span className="status-icon spinning">⚙️</span>
            <span className="status-message">{getStepIcon(message)} {message}</span>
            <span className="status-percent">{progress}%</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </>
      )}

      {state === 'completed' && (
        <div className="status-header">
          <span className="status-icon">✅</span>
          <span className="status-message">{message}</span>
        </div>
      )}

      {state === 'error' && (
        <div className="error-card">
          <div className="error-card-title">
            <span>❌</span> Dubbing Failed
          </div>
          <p className="error-card-message">
            {message.length > 150 ? 'An unexpected error occurred. Please try again.' : message}
          </p>
          {debug && <pre className="error-debug">{debug}</pre>}
          {onRetry && (
            <button className="btn btn-retry" onClick={onRetry}>
              ↩ Try Again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
