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
 */
async function assembleDubbedAudio(segments, videoDuration, outputPath, tempDir) {
  const valid = segments.filter(s => s.audioFile && fs.existsSync(s.audioFile));

  if (valid.length === 0) throw new Error('No valid TTS segments to assemble');

  // Create a silent base track covering the full video duration
  const silencePath = path.join(tempDir, 'silence.mp3');
  await createSilence(Math.ceil(videoDuration) + 3, silencePath);

  // Build FFmpeg filter: delay each segment to its original start time, then mix all
  const inputs = [silencePath, ...valid.map(s => s.audioFile)];
  let filterParts = '';
  const streamLabels = [];

  valid.forEach((seg, i) => {
    const delayMs = Math.round(seg.start * 1000);
    const label = `a${i}`;
    filterParts += `[${i + 1}:a]adelay=${delayMs}|${delayMs}[${label}];`;
    streamLabels.push(`[${label}]`);
  });

  // Mix the silence base with all delayed TTS streams; normalize=0 prevents volume reduction
  const filterComplex =
    filterParts +
    `[0:a]${streamLabels.join('')}amix=inputs=${valid.length + 1}:normalize=0[out]`;

  await new Promise((resolve, reject) => {
    let cmd = ffmpeg();
    inputs.forEach(input => cmd.input(input));
    cmd
      .complexFilter(filterComplex)
      .outputOptions(['-map', '[out]', '-acodec', 'libmp3lame', '-q:a', '3'])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
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
