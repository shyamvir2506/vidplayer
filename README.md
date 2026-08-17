# Hindi Video Dubber

**GitHub:** https://github.com/shyamvir2506/vidplayer

Real-time AI-powered Hindi dubbing webapp.

## Architecture

```
Video upload → FFmpeg (extract audio)
  → Whisper (transcribe to English, local, free)
  → NLLB-200 (translate English → Hindi, local, free)
  → Google TTS (Hindi voice synthesis, free tier)
  → FFmpeg (assemble timed audio) → synced playback in browser
```

## Prerequisites

- Node.js 18+
- FFmpeg is bundled via `@ffmpeg-installer/ffmpeg` — no system install needed
- ⭐ **No API keys required!** Uses 100% free, open-source models:
  - **Whisper** (OpenAI's open model, runs locally) for speech-to-text
  - **NLLB-200** (Meta's model, runs locally) for English→Hindi translation
  - **Google TTS** (free tier, no authentication) for Hindi voice synthesis

## Setup

### 1. Backend

```bash
cd backend
npm install
npm run dev
```

**First run:** Models auto-download (~2-3 min for Whisper + NLLB). Subsequent runs use cached models.

### 2. Frontend

```bash
cd frontend
npm install
npm start
```

Open `http://localhost:3000`.

## Usage

1. Drag & drop or select a video file (mp4, avi, mov, mkv, webm — up to 500 MB)
2. Click **🎙️ Dub in Hindi**
3. Watch the progress bar as the pipeline runs (typically 1–3 min per minute of video)
4. When complete, the dubbed audio auto-activates — toggle with **Hindi Dub ON/OFF**

## Pipeline Details

| Step | Service | Notes |
|------|---------|-------|
| Speech-to-text | Whisper (local) | Free, open-source, no API key |
| Translation | NLLB-200 (local) | Free, open-source, preserves tone |
| Text-to-speech | Google TTS (free tier) | No authentication needed |
| Audio assembly | FFmpeg concat demuxer | Reliable segment timing |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Backend port (default: 5000) |
| `FRONTEND_URL` | Frontend URL for deployment (optional) |

## Alternatives (if any service fails)

The app includes a **fallback mock transcription** that generates placeholder segments covering the entire video. This ensures the pipeline keeps running even if Whisper temporarily fails. The dubbed audio will play throughout the entire video duration.
