import React, { useState, useRef, useCallback } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || '';
import './App.css';
import VideoPlayer from './components/VideoPlayer';
import UploadSection from './components/UploadSection';
import DubbingStatus from './components/DubbingStatus';

export default function App() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [dubbedAudioUrl, setDubbedAudioUrl] = useState(null);
  const [isDubActive, setIsDubActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const pollingRef = useRef(null);
  const pollErrorCountRef = useRef(0);

  const handleVideoSelect = useCallback((file) => {
    // Revoke previous blob URL to avoid memory leaks
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    setDubbedAudioUrl(null);
    setJobStatus(null);
    setJobId(null);
    setIsDubActive(false);
    clearInterval(pollingRef.current);
  }, [videoUrl]);

  const handleDub = async () => {
    if (!videoFile) return;
    setIsUploading(true);
    setJobStatus({ status: 'processing', progress: 0, message: 'Uploading video...' });
    setDubbedAudioUrl(null);
    setIsDubActive(false);

    try {
      const formData = new FormData();
      formData.append('video', videoFile);
      const { data } = await axios.post(`${API}/api/dub`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setJobId(data.jobId);
      startPolling(data.jobId);
    } catch (err) {
      const raw = err.response?.data?.error;
      // Only use the server message if it's a short plain string
      const safe = typeof raw === 'string' && raw.length < 120 ? raw : 'Upload failed. Please try again.';
      setJobStatus({ status: 'error', message: safe });
    } finally {
      setIsUploading(false);
    }
  };

  const startPolling = (id) => {
    clearInterval(pollingRef.current);
    pollErrorCountRef.current = 0;
    pollingRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get(`${API}/api/status/${id}`);
        pollErrorCountRef.current = 0;
        setJobStatus(data);
        if (data.status === 'completed') {
          clearInterval(pollingRef.current);
          setDubbedAudioUrl(`${API}${data.audioUrl}`);
          setIsDubActive(true);
        } else if (data.status === 'error') {
          clearInterval(pollingRef.current);
        }
      } catch (err) {
        if (err?.response?.status === 404) {
          clearInterval(pollingRef.current);
          setJobStatus({
            status: 'error',
            message: 'Job not found. The backend was likely restarted. Please upload and start dubbing again.'
          });
          return;
        }

        pollErrorCountRef.current += 1;
        if (pollErrorCountRef.current >= 5) {
          clearInterval(pollingRef.current);
          setJobStatus({ status: 'error', message: 'Lost connection to server.' });
        }
      }
    }, 2000);
  };

  const toggleDubbing = () => setIsDubActive(prev => !prev);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-logo">
          <span className="logo-icon">🎬</span>
          <h1>Hindi Dubber</h1>
        </div>
        <p className="header-subtitle">Upload a video and get real-time Hindi dubbing powered by AI</p>
      </header>

      <main className="app-main">
        {videoUrl ? (
          <VideoPlayer
            videoUrl={videoUrl}
            audioUrl={dubbedAudioUrl}
            isDubActive={isDubActive}
          />
        ) : (
          <div className="player-placeholder">
            <span className="placeholder-icon">▶</span>
            <p>Your video will appear here</p>
          </div>
        )}

        <div className="controls-panel">
          <UploadSection
            onVideoSelect={handleVideoSelect}
            currentFile={videoFile}
          />

          <div className="action-row">
            <button
              className="btn btn-dub"
              onClick={handleDub}
              disabled={!videoFile || isUploading || jobStatus?.status === 'processing'}
            >
              {isUploading || jobStatus?.status === 'processing'
                ? 'Processing...'
                : '🎙️ Dub in Hindi'}
            </button>

            {dubbedAudioUrl && (
              <button
                className={`btn btn-toggle ${isDubActive ? 'active' : ''}`}
                onClick={toggleDubbing}
              >
                {isDubActive ? '🔊 Hindi Dub ON' : '🔇 Original Audio'}
              </button>
            )}
          </div>

          {jobStatus && <DubbingStatus status={jobStatus} onRetry={jobStatus.status === 'error' ? handleDub : null} />}
        </div>
      </main>

      <footer className="app-footer">
        <p>Powered by OpenAI Whisper · GPT · Google TTS · FFmpeg</p>
      </footer>
    </div>
  );
}
