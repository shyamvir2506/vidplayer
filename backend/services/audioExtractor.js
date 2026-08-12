const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

function extractAudio(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        '-vn',           // no video
        '-acodec', 'libmp3lame',
        '-ar', '16000',  // 16kHz sample rate (optimal for Whisper)
        '-ac', '1',      // mono
        '-q:a', '4'
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

module.exports = { extractAudio };
