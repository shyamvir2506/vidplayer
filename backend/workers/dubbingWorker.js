// Runs the CPU-heavy dubbing pipeline on a worker thread so the main HTTP
// server's event loop stays responsive while Whisper/NLLB inference runs.
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');

const { extractAudio } = require('../services/audioExtractor');
const { transcribeAudio } = require('../services/transcription');
const { translateToHindi } = require('../services/translation');
const { generateTTS } = require('../services/tts');
const { assembleDubbedAudio } = require('../services/audioAssembler');

const { videoPath, tempDir, outputPath } = workerData;

function setProgress(progress, message) {
  parentPort.postMessage({ type: 'progress', progress, message });
}

async function run() {
  try {
    fs.mkdirSync(tempDir, { recursive: true });

    setProgress(10, 'Extracting audio from video...');
    const audioPath = path.join(tempDir, 'audio.wav');
    await extractAudio(videoPath, audioPath);

    setProgress(25, 'Transcribing speech...');
    const segments = await transcribeAudio(audioPath, (progress, message) => {
      setProgress(progress, message);
    });

    if (!segments || segments.length === 0) {
      throw new Error('No speech detected in the video');
    }

    setProgress(50, 'Translating to Hindi...');
    const hindiSegments = await translateToHindi(segments, (progress, message) => {
      setProgress(progress, message);
    });

    setProgress(65, 'Generating Hindi voice...');
    const ttsSegments = await generateTTS(hindiSegments, tempDir, (progress, message) => {
      setProgress(progress, message);
    });

    setProgress(85, 'Assembling dubbed audio track...');
    const videoDuration = segments[segments.length - 1]?.end || 60;
    await assembleDubbedAudio(ttsSegments, videoDuration, outputPath, tempDir);

    parentPort.postMessage({ type: 'done' });
  } catch (err) {
    parentPort.postMessage({
      type: 'error',
      name: err.constructor?.name,
      message: err.message
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlink(videoPath, () => {});
  }
}

run();
