const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { extractAudio } = require('../services/audioExtractor');
const { transcribeAudio } = require('../services/transcription');
const { translateToHindi } = require('../services/translation');
const { generateTTS } = require('../services/tts');
const { assembleDubbedAudio } = require('../services/audioAssembler');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (req, file, cb) => {
    if (/\.(mp4|avi|mov|mkv|webm)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only video files are allowed (mp4, avi, mov, mkv, webm)'));
  }
});

// In-memory job store (use Redis for production)
const jobs = new Map();

router.post('/dub', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file provided' });

  const jobId = uuidv4();
  jobs.set(jobId, { status: 'processing', progress: 0, message: 'Job queued...' });
  res.json({ jobId });

  processVideo(jobId, req.file.path).catch(err => {
    console.error(`Job ${jobId} failed:`, err);
    jobs.set(jobId, { status: 'error', progress: 0, message: friendlyError(err) });
  });
});

router.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

async function processVideo(jobId, videoPath) {
  const tempDir = path.join(__dirname, '../temp', jobId);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    setJob(jobId, 10, 'Extracting audio from video...');
    const audioPath = path.join(tempDir, 'audio.mp3');
    await extractAudio(videoPath, audioPath);

    setJob(jobId, 25, 'Transcribing speech...');
    const segments = await transcribeAudio(audioPath);

    if (!segments || segments.length === 0) {
      throw new Error('No speech detected in the video');
    }

    setJob(jobId, 50, 'Translating to Hindi...');
    const hindiSegments = await translateToHindi(segments);

    setJob(jobId, 65, 'Generating Hindi voice...');
    const ttsSegments = await generateTTS(hindiSegments, tempDir);

    setJob(jobId, 85, 'Assembling dubbed audio track...');
    const outputPath = path.join(__dirname, '../processed', `${jobId}.mp3`);
    const videoDuration = segments[segments.length - 1]?.end || 60;
    await assembleDubbedAudio(ttsSegments, videoDuration, outputPath, tempDir);

    jobs.set(jobId, {
      status: 'completed',
      progress: 100,
      message: 'Hindi dubbing complete!',
      audioUrl: `/processed/${jobId}.mp3`
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlink(videoPath, () => {});
  }
}

function setJob(jobId, progress, message) {
  jobs.set(jobId, { status: 'processing', progress, message });
}

function friendlyError(err) {
  const msg = err.message || '';
  if (err.constructor?.name === 'APIConnectionError' || msg.includes('Connection error') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND'))
    return 'Cannot reach OpenAI API. Check your internet connection or firewall settings.';
  if (err.status === 401 || msg.includes('401') || msg.includes('Incorrect API key'))
    return 'Invalid OpenAI API key. Update OPENAI_API_KEY in backend/.env.';
  if (err.status === 429 || msg.includes('429') || msg.includes('Rate limit'))
    return 'OpenAI rate limit reached. Wait a moment and try again.';
  if (err.status === 413 || msg.includes('too large') || msg.includes('file size'))
    return 'Audio file is too large for the Whisper API (max 25 MB). Try a shorter video.';
  if (msg.includes('No speech detected'))
    return 'No speech detected in this video — nothing to dub.';
  if (msg.includes('ffmpeg') || msg.includes('ENOENT'))
    return 'FFmpeg error while processing the video. Make sure the file is not corrupted.';
  // Avoid leaking raw API responses or stack traces to the client
  return 'An unexpected error occurred. Please try again.';
}

module.exports = router;
