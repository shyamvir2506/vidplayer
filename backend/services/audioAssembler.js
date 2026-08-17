const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('ffprobe-static').path;
const fs = require('fs');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/**
 * Assembles individual TTS audio segments into a single timed audio track
 * that matches the original video timeline.
 * Simplified approach: pad each segment with leading silence, then concatenate.
 */
async function assembleDubbedAudio(segments, videoDuration, outputPath, tempDir) {
  const valid = segments.filter(s => s.audioFile && fs.existsSync(s.audioFile));

  if (valid.length === 0) throw new Error('No valid TTS segments to assemble');

  // Create a concat file for FFmpeg
  const concatFilePath = path.join(tempDir, 'concat.txt');
  const paddedFiles = [];
  let currentTime = 0;

  // For each segment, create a padded version with leading silence
  for (let i = 0; i < valid.length; i++) {
    const seg = valid[i];
    const delayFromPrev = seg.start - currentTime;
    const paddedPath = path.join(tempDir, `padded_${i}.mp3`);
    
    if (delayFromPrev > 0) {
      // Add silence before this segment
      const silencePath = path.join(tempDir, `silence_${i}.mp3`);
      await createSilence(delayFromPrev, silencePath);
      paddedFiles.push(silencePath);
    }

    // Add the TTS audio file
    paddedFiles.push(seg.audioFile);
    currentTime = seg.end;
  }

  // Add trailing silence if needed
  const trailingDuration = videoDuration - currentTime;
  if (trailingDuration > 0) {
    const trailingSilencePath = path.join(tempDir, 'trailing_silence.mp3');
    await createSilence(trailingDuration, trailingSilencePath);
    paddedFiles.push(trailingSilencePath);
  }

  // Create FFmpeg concat file
  const concatContent = paddedFiles
    .map(file => `file '${file.replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(concatFilePath, concatContent);

  // Use concat demuxer (more reliable than filters)
  await new Promise((resolve, reject) => {
    console.log(`Concatenating ${paddedFiles.length} audio segments...`);
    
    ffmpeg()
      .input(concatFilePath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-acodec', 'libmp3lame', '-q:a', '3'])
      .output(outputPath)
      .on('end', () => {
        console.log('Audio assembly complete');
        resolve();
      })
      .on('error', (err) => {
        console.error('Audio assembly error:', err.message);
        reject(err);
      })
      .run();
  });
}

function createSilence(durationSecs, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input('anullsrc=r=44100:cl=stereo')
      .inputOptions(['-f', 'lavfi'])
      .outputOptions(['-t', String(durationSecs), '-acodec', 'libmp3lame', '-q:a', '9'])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

module.exports = { assembleDubbedAudio };
