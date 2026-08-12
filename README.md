# Hindi Video Dubber

**GitHub:** https://github.com/shyamvir2506/vidplayer

Real-time AI-powered Hindi dubbing webapp.

## Architecture

```
Video upload → FFmpeg (extract audio) → OpenAI Whisper (transcribe)
    → GPT-3.5 (translate to Hindi) → Google TTS (Hindi voice)
    → FFmpeg (assemble timed audio) → synced playback in browser
```

## Prerequisites

- Node.js 18+
- An **OpenAI API key** (for Whisper transcription + GPT translation)
- FFmpeg is bundled via `@ffmpeg-installer/ffmpeg` — no system install needed

## Setup

### 1. Backend

```bash
cd backend
npm install
cp .env
# Add your OpenAI API key to .env
npm run dev
```

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
| Audio extraction | FFmpeg | 16 kHz mono MP3 |
| Speech-to-text | OpenAI Whisper | Returns word-level timestamps |
| Translation | OpenAI GPT-3.5-turbo | Batched, preserves tone |
| Text-to-speech | Google TTS (unofficial) | Hindi (hi) voice |
| Audio assembly | FFmpeg `adelay + amix` | Each segment placed at original timestamp |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Required — Whisper + GPT calls |
| `PORT` | Backend port (default: 5000) |
