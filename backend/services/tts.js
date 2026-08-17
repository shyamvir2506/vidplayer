const googleTTS = require('google-tts-api');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Bypass corporate SSL-inspection proxy (same setting as server.js)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const SEGMENT_CONCURRENCY = Number(process.env.TTS_SEGMENT_CONCURRENCY || 6);
const CHUNK_CONCURRENCY = Number(process.env.TTS_CHUNK_CONCURRENCY || 4);
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'
};

async function generateTTS(segments, tempDir, onProgress) {
  const tasks = segments.map((segment, index) => ({ segment, index }));
  const results = new Array(segments.length);
  let completed = 0;

  const notifyProgress = () => {
    if (typeof onProgress !== 'function') return;
    const ratio = segments.length === 0 ? 1 : completed / segments.length;
    const progress = 65 + Math.round(ratio * 20);
    onProgress(progress, `Generating Hindi voice... (${completed}/${segments.length})`);
  };

  async function worker() {
    while (tasks.length > 0) {
      const item = tasks.shift();
      if (!item) return;

      const { segment, index } = item;
      const text = (segment.hindiText || '').trim();
      if (!text) {
        results[index] = { ...segment, audioFile: null };
        completed++;
        notifyProgress();
        continue;
      }

      const audioPath = path.join(tempDir, `seg_${segment.id}.mp3`);
      try {
        await downloadHindiAudio(text, audioPath);
        results[index] = { ...segment, audioFile: audioPath };
      } catch (err) {
        console.warn(`TTS failed for segment ${segment.id}:`, err.message);
        results[index] = { ...segment, audioFile: null };
      } finally {
        completed++;
        notifyProgress();
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(SEGMENT_CONCURRENCY, Math.max(1, tasks.length)) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

async function downloadHindiAudio(text, outputPath) {
  // getAllAudioUrls splits long text into ≤200-char chunks automatically
  const urls = googleTTS.getAllAudioUrls(text, {
    lang: 'hi',
    slow: false,
    host: 'https://translate.google.com',
    splitPunct: '.,!?।'
  });

  const buffers = await mapWithConcurrency(urls, CHUNK_CONCURRENCY, async ({ url }) => {
    return downloadChunkWithRetry(url);
  });

  fs.writeFileSync(outputPath, Buffer.concat(buffers));
}

async function downloadChunkWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: REQUEST_TIMEOUT_MS,
        httpsAgent,
        headers: REQUEST_HEADERS
      });
      return Buffer.from(res.data);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await delay(250 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const queue = items.map((item, index) => ({ item, index }));
  const results = new Array(items.length);

  async function runner() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      results[next.index] = await mapper(next.item);
    }
  }

  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
    () => runner()
  );

  await Promise.all(runners);
  return results;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { generateTTS };
