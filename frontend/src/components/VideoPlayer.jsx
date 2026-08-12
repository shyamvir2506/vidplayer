import React, { useRef, useEffect, useCallback } from 'react';

/**
 * Plays the video and keeps a hidden dubbed audio element in perfect sync.
 * When isDubActive the video is muted and dubbed audio plays instead.
 */
export default function VideoPlayer({ videoUrl, audioUrl, isDubActive }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  // Sync audio element to video whenever dubbed audio is loaded or toggled
  const syncAudio = useCallback(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;
    audio.currentTime = video.currentTime;
    if (!video.paused && isDubActive) audio.play().catch(() => {});
    else audio.pause();
  }, [isDubActive]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      if (audioRef.current && isDubActive) {
        audioRef.current.currentTime = video.currentTime;
        audioRef.current.play().catch(() => {});
      }
    };
    const onPause = () => audioRef.current?.pause();
    const onSeeked = () => {
      if (audioRef.current) audioRef.current.currentTime = video.currentTime;
    };
    const onRateChange = () => {
      if (audioRef.current) audioRef.current.playbackRate = video.playbackRate;
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ratechange', onRateChange);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ratechange', onRateChange);
    };
  }, [isDubActive]);

  // Re-sync whenever isDubActive toggles
  useEffect(() => {
    syncAudio();
  }, [isDubActive, syncAudio]);

  return (
    <div className="video-wrapper">
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        muted={isDubActive}
        className="video-element"
        playsInline
      />

      {/* Hidden audio element carries the dubbed track */}
      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="auto" style={{ display: 'none' }} />
      )}

      {isDubActive && audioUrl && (
        <div className="dub-badge">🎙️ Hindi Dub Active</div>
      )}
    </div>
  );
}
