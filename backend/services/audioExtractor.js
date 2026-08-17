const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

function extractAudio(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        '-vn',              // no video
        '-acodec', 'pcm_s16le', // uncompressed PCM (required for local Whisper decoding)
        '-ar', '16000',     // 16kHz sample rate (required by Whisper)
        '-ac', '1'          // mono
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

module.exports = { extractAudio };
