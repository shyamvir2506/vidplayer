import React, { useRef, useState } from 'react';

export default function UploadSection({ onVideoSelect, currentFile }) {
  const inputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFile = (file) => {
    if (!file) return;
    if (!/\.(mp4|avi|mov|mkv|webm)$/i.test(file.name)) {
      alert('Please select a valid video file (mp4, avi, mov, mkv, webm)');
      return;
    }
    onVideoSelect(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      className={`upload-section ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/avi,video/mov,video/x-matroska,video/webm,.mp4,.avi,.mov,.mkv,.webm"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files[0])}
      />

      {currentFile ? (
        <div className="file-info">
          <span className="file-icon">🎥</span>
          <div>
            <p className="file-name">{currentFile.name}</p>
            <p className="file-size">{formatSize(currentFile.size)}</p>
          </div>
          <span className="change-hint">Click to change</span>
        </div>
      ) : (
        <div className="upload-prompt">
          <span className="upload-icon">⬆️</span>
          <p>Drag & drop a video or <strong>click to browse</strong></p>
          <p className="upload-hint">MP4, AVI, MOV, MKV, WebM · up to 500 MB</p>
        </div>
      )}
    </div>
  );
}
