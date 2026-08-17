const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Worker } = require('worker_threads');

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

  processVideo(jobId, req.file.path);
});

router.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

function processVideo(jobId, videoPath) {
  const tempDir = path.join(__dirname, '../temp', jobId);
  const outputPath = path.join(__dirname, '../processed', `${jobId}.mp3`);

  const worker = new Worker(path.join(__dirname, '../workers/dubbingWorker.js'), {
    workerData: { videoPath, tempDir, outputPath }
  });

  worker.on('message', (msg) => {
    if (msg.type === 'progress') {
      jobs.set(jobId, { status: 'processing', progress: msg.progress, message: msg.message });
    } else if (msg.type === 'done') {
      jobs.set(jobId, {
        status: 'completed',
        progress: 100,
        message: 'Hindi dubbing complete!',
        audioUrl: `/processed/${jobId}.mp3`
      });
    } else if (msg.type === 'error') {
      console.error(`Job ${jobId} failed:`, msg.message);
      jobs.set(jobId, {
        status: 'error',
        progress: 0,
        message: friendlyError(msg),
        // Expose raw error outside production so the UI can show it for debugging
        debug: process.env.NODE_ENV !== 'production'
          ? `${msg.name}: ${msg.message}`.slice(0, 300)
          : undefined
      });
    }
  });

  worker.on('error', (err) => {
    console.error(`Job ${jobId} worker crashed:`, err);
    jobs.set(jobId, {
      status: 'error',
      progress: 0,
      message: friendlyError(err),
      debug: process.env.NODE_ENV !== 'production'
        ? `${err.constructor?.name}: ${err.message}`.slice(0, 300)
        : undefined
    });
  });
}

function friendlyError(err) {
  const msg = err.message || err.toString?.() || '';
  if (msg.includes('Connection error') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND'))
    return 'Network error during processing. Check your internet connection.';
  if (msg.includes('CUDA') || msg.includes('out of memory') || msg.includes('memory'))
    return 'Insufficient system memory. Try a shorter video or close other applications.';
  if (msg.includes('No speech detected'))
    return 'No speech detected in this video — nothing to dub.';
  if (msg.includes('ffmpeg') || msg.includes('ENOENT'))
    return 'FFmpeg error while processing the video. Make sure the file is not corrupted.';
  if (msg.includes('model') || msg.includes('download'))
    return 'AI model loading failed. This may be a temporary issue — please try again.';
  // Avoid leaking raw errors or stack traces to the client
  return 'An unexpected error occurred. Please try again.';
}

module.exports = router;
