const googleTTS = require('google-tts-api');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Bypass corporate SSL-inspection proxy (same setting as server.js)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function generateTTS(segments, tempDir) {
  const results = [];

  for (const segment of segments) {
    const text = (segment.hindiText || '').trim();
    if (!text) {
      results.push({ ...segment, audioFile: null });
      continue;
    }

    const audioPath = path.join(tempDir, `seg_${segment.id}.mp3`);
    try {
      await downloadHindiAudio(text, audioPath);
      results.push({ ...segment, audioFile: audioPath });
    } catch (err) {
      console.warn(`TTS failed for segment ${segment.id}:`, err.message);
      results.push({ ...segment, audioFile: null });
    }
  }

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

  const buffers = [];
  for (const { url } of urls) {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      httpsAgent,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'
      }
    });
    buffers.push(Buffer.from(res.data));
  }

  fs.writeFileSync(outputPath, Buffer.concat(buffers));
}

module.exports = { generateTTS };
