const fs = require('fs');

// Use Whisper via @xenova/transformers - completely free, local, no API key needed
let pipeline;
let pipelineReady = false;
const ALLOW_MOCK_TRANSCRIPTION = (process.env.ALLOW_MOCK_TRANSCRIPTION || 'false').toLowerCase() === 'true';
const TRANSCRIPTION_SPEED_MODE = (process.env.TRANSCRIPTION_SPEED_MODE || 'fast').toLowerCase();
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'Xenova/whisper-tiny.en';
const SILENCE_THRESHOLD = Number(process.env.SILENCE_THRESHOLD || 0.003);
const FAST_CHUNK_WINDOW_SECS = Number(process.env.FAST_CHUNK_WINDOW_SECS || 75);
const FAST_WHISPER_CHUNK_LENGTH_SECS = Number(process.env.FAST_WHISPER_CHUNK_LENGTH_SECS || 45);
const FAST_WHISPER_STRIDE_SECS = Number(process.env.FAST_WHISPER_STRIDE_SECS || 1);
const FAST_TARGET_SEGMENT_SECS = Number(process.env.FAST_TARGET_SEGMENT_SECS || 45);
const FAST_MAX_SEGMENTS_PER_CHUNK = Number(process.env.FAST_MAX_SEGMENTS_PER_CHUNK || 4);
const FAST_MERGE_MAX_DURATION_SECS = Number(process.env.FAST_MERGE_MAX_DURATION_SECS || 55);
const FAST_MERGE_MAX_CHARS = Number(process.env.FAST_MERGE_MAX_CHARS || 320);

async function initializeWhisper() {
  if (pipelineReady) return pipeline;
  
  try {
    const { pipeline: createPipeline } = await import('@xenova/transformers');
    console.log(`Loading Whisper model: ${WHISPER_MODEL} (first run may take a while)...`);
    try {
      // Prefer 8-bit quantized inference for faster CPU performance.
      pipeline = await createPipeline('automatic-speech-recognition', WHISPER_MODEL, { dtype: 'q8' });
    } catch (quantErr) {
      console.warn('Quantized load failed, retrying default precision:', quantErr.message);
      pipeline = await createPipeline('automatic-speech-recognition', WHISPER_MODEL);
    }
    pipelineReady = true;
    console.log('✓ Whisper model loaded');
    return pipeline;
  } catch (err) {
    console.error('Failed to load Whisper:', err.message);
    throw err;
  }
}

async function transcribeAudio(audioPath, onProgress) {
  try {
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    console.log(`Transcribing with Whisper: ${audioPath}`);
    
    if (typeof onProgress === 'function') {
      onProgress(28, 'Preparing audio for transcription...');
    }

    // Initialize Whisper if not already done
    const whisper = await initializeWhisper();

    if (typeof onProgress === 'function') {
      onProgress(32, 'Decoding audio...');
    }

    const audioData = decodeWavToFloat32(audioPath);
    const totalDuration = audioData.samples.length / audioData.sampleRate;
    const chunkWindowSecs = TRANSCRIPTION_SPEED_MODE === 'accurate' ? 30 : FAST_CHUNK_WINDOW_SECS;
    const chunkRanges = buildChunkRanges(totalDuration, chunkWindowSecs);
    
    let segments = [];

    if (chunkRanges.length <= 1) {
      // Single pass for short audio files.
      console.log('Processing short audio with Whisper...');
      if (typeof onProgress === 'function') {
        onProgress(38, 'Running Whisper transcription...');
      }

      const result = await transcribeChunk(whisper, audioData.samples, audioData.sampleRate, 10 * 60 * 1000);

      if (typeof onProgress === 'function') {
        onProgress(45, 'Finalizing transcription segments...');
      }

      segments = parseChunkResult(result, audioPath, totalDuration, 0);
    } else {
      // Chunked path for long audio so progress and reliability improve.
      console.log(`Processing long audio in ${chunkRanges.length} chunks...`);
      let rawSegments = [];

      for (let i = 0; i < chunkRanges.length; i++) {
        const range = chunkRanges[i];

        if (typeof onProgress === 'function') {
          const ratio = i / chunkRanges.length;
          const pct = 38 + Math.round(ratio * 7);
          onProgress(pct, `Running Whisper transcription... (${i + 1}/${chunkRanges.length})`);
        }

        const chunkSamples = sliceAudioSamples(
          audioData.samples,
          audioData.sampleRate,
          range.start,
          range.duration
        );

        if (isLikelySilence(chunkSamples)) {
          continue;
        }

        const result = await transcribeChunk(
          whisper,
          chunkSamples,
          audioData.sampleRate,
          4 * 60 * 1000,
          i + 1
        );

        const chunkSegments = parseChunkResult(
          result,
          audioPath,
          range.duration,
          range.start
        );

        rawSegments.push(...chunkSegments);
      }

      segments = normalizeSegments(rawSegments, totalDuration);
      if (TRANSCRIPTION_SPEED_MODE !== 'accurate') {
        const before = segments.length;
        segments = mergeSegmentsForSpeed(segments, totalDuration);
        console.log(`Merged segments for speed: ${before} -> ${segments.length}`);
      }
      if (typeof onProgress === 'function') {
        onProgress(45, 'Finalizing transcription segments...');
      }
    }

    if (!segments || segments.length === 0) {
      throw new Error('No speech detected in the video');
    }

    console.log(`✓ Transcription complete with ${segments.length} segments`);
    return segments;
  } catch (err) {
    console.error('Transcription error:', err.message);
    if (ALLOW_MOCK_TRANSCRIPTION) {
      console.log('ALLOW_MOCK_TRANSCRIPTION=true, using mock segments.');
      return getMockSegments(audioPath);
    }
    throw err;
  }
}

async function transcribeChunk(whisper, samples, sampleRate, timeoutMs, chunkIndex) {
  const baseOptions = {
    sampling_rate: sampleRate,
    chunk_length_s: TRANSCRIPTION_SPEED_MODE === 'accurate' ? 20 : FAST_WHISPER_CHUNK_LENGTH_SECS,
    stride_length_s: TRANSCRIPTION_SPEED_MODE === 'accurate' ? 5 : FAST_WHISPER_STRIDE_SECS
  };

  const options = TRANSCRIPTION_SPEED_MODE === 'accurate'
    ? { ...baseOptions, return_timestamps: true }
    : { ...baseOptions, return_timestamps: false };

  return withTimeout(
    whisper(samples, options),
    timeoutMs,
    chunkIndex
      ? `Transcription timed out for chunk ${chunkIndex}`
      : 'Transcription timed out. Try a shorter video or retry.'
  );
}

function parseChunkResult(result, audioPath, chunkDuration, offsetSeconds) {
  if (TRANSCRIPTION_SPEED_MODE === 'accurate') {
    return parseWhisperChunks(result, audioPath).map((seg) => ({
      ...seg,
      start: seg.start + offsetSeconds,
      end: seg.end + offsetSeconds
    }));
  }

  const text = (result?.text || '').trim();
  if (!text) return [];

  return textToEstimatedSegments(text, chunkDuration).map((seg) => ({
    ...seg,
    id: seg.id,
    start: seg.start + offsetSeconds,
    end: seg.end + offsetSeconds
  }));
}

function sliceAudioSamples(samples, sampleRate, startSeconds, durationSeconds) {
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.min(samples.length, Math.ceil((startSeconds + durationSeconds) * sampleRate));
  return samples.subarray(start, end);
}

function isLikelySilence(samples) {
  if (!samples || samples.length === 0) return true;

  // Sample a subset for speed.
  const stride = Math.max(1, Math.floor(samples.length / 5000));
  let sum = 0;
  let count = 0;

  for (let i = 0; i < samples.length; i += stride) {
    sum += Math.abs(samples[i]);
    count++;
  }

  const meanAbs = count > 0 ? sum / count : 0;
  return meanAbs < SILENCE_THRESHOLD;
}

function buildChunkRanges(totalDuration, chunkWindowSecs) {
  const ranges = [];
  if (!Number.isFinite(totalDuration) || totalDuration <= chunkWindowSecs) {
    return [{ start: 0, duration: Math.max(1, totalDuration || chunkWindowSecs) }];
  }

  let start = 0;
  while (start < totalDuration) {
    const duration = Math.min(chunkWindowSecs, totalDuration - start);
    ranges.push({ start, duration });
    start += duration;
  }

  return ranges;
}

function normalizeSegments(segments, totalDuration) {
  const cleaned = segments
    .filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
    .map((s) => ({ ...s, text: s.text.trim() }))
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < cleaned.length; i++) {
    if (i > 0 && cleaned[i].start < cleaned[i - 1].end) {
      cleaned[i].start = cleaned[i - 1].end;
    }
    if (cleaned[i].end <= cleaned[i].start) {
      cleaned[i].end = Math.min(totalDuration, cleaned[i].start + 0.75);
    }
    cleaned[i].start = Math.max(0, cleaned[i].start);
    cleaned[i].end = Math.min(totalDuration, cleaned[i].end);
    cleaned[i].id = i;
  }

  return cleaned.filter((s) => s.end > s.start);
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

function decodeWavToFloat32(audioPath) {
  const buffer = fs.readFileSync(audioPath);

  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Unsupported WAV file format');
  }

  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkDataStart),
        channels: buffer.readUInt16LE(chunkDataStart + 2),
        sampleRate: buffer.readUInt32LE(chunkDataStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkDataStart + 14)
      };
    } else if (chunkId === 'data') {
      dataOffset = chunkDataStart;
      dataSize = chunkSize;
      break;
    }

    // Chunks are word-aligned, so round up odd sizes.
    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (!fmt || dataOffset < 0) {
    throw new Error('Invalid WAV file: missing fmt or data chunk');
  }

  if (fmt.audioFormat !== 1 || fmt.channels !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(
      `Unsupported WAV encoding: format=${fmt.audioFormat}, channels=${fmt.channels}, bits=${fmt.bitsPerSample}`
    );
  }

  const sampleCount = Math.floor(dataSize / 2);
  const samples = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const s = buffer.readInt16LE(dataOffset + i * 2);
    samples[i] = Math.max(-1, s / 32768);
  }

  return {
    sampleRate: fmt.sampleRate,
    samples
  };
}

function parseWhisperChunks(result, audioPath) {
  const estimatedDuration = estimateDuration(audioPath);

  if (Array.isArray(result?.chunks) && result.chunks.length > 0) {
    const segments = [];
    for (const chunk of result.chunks) {
      const text = (chunk?.text || '').trim();
      if (!text) continue;

      const timestamp = Array.isArray(chunk?.timestamp) ? chunk.timestamp : [];
      const start = sanitizeTime(timestamp[0], 0);
      const endCandidate = sanitizeTime(timestamp[1], start + 1);
      const end = Math.min(Math.max(endCandidate, start + 0.5), estimatedDuration);

      segments.push({
        id: segments.length,
        start,
        end,
        text
      });
    }

    // Fix overlaps/non-monotonic timestamps defensively.
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].start < segments[i - 1].end) {
        segments[i].start = segments[i - 1].end;
      }
      if (segments[i].end <= segments[i].start) {
        segments[i].end = Math.min(estimatedDuration, segments[i].start + 0.75);
      }
    }

    const bounded = segments.filter((s) => s.text.length > 0 && s.end > s.start);
    if (bounded.length > 0) return bounded;
  }

  // Fallback: derive segments from full text if chunks are unavailable.
  const fullText = (result?.text || '').trim();
  if (!fullText) return [];
  return textToEstimatedSegments(fullText, estimatedDuration);
}

function textToEstimatedSegments(fullText, estimatedDuration) {
  const segments = [];
  const words = fullText.split(/\s+/);
  const isFast = TRANSCRIPTION_SPEED_MODE !== 'accurate';
  const targetSegmentsByDuration = Math.max(
    1,
    Math.ceil(estimatedDuration / (isFast ? FAST_TARGET_SEGMENT_SECS : 15))
  );
  const targetSegmentCount = isFast
    ? Math.min(FAST_MAX_SEGMENTS_PER_CHUNK, Math.max(1, targetSegmentsByDuration))
    : Math.min(24, Math.max(4, targetSegmentsByDuration));
  const wordsPerSegment = Math.max(isFast ? 30 : 12, Math.ceil(words.length / targetSegmentCount));
  const segmentDurationSecs = Math.max(
    isFast ? 20 : 8,
    Math.round(estimatedDuration / Math.max(1, Math.ceil(words.length / wordsPerSegment)))
  );

  let currentTime = 0;
  for (let i = 0; i < words.length; i += wordsPerSegment) {
    const text = words.slice(i, i + wordsPerSegment).join(' ').trim();
    if (!text) continue;
    const end = Math.min(estimatedDuration, currentTime + segmentDurationSecs);
    segments.push({ id: segments.length, start: currentTime, end, text });
    currentTime = end;
  }

  return segments;
}

function mergeSegmentsForSpeed(segments, totalDuration) {
  if (!Array.isArray(segments) || segments.length <= 1) return segments || [];

  const merged = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const next = segments[i];
    const canMerge =
      next.start - current.end <= 1.5 &&
      next.end - current.start <= FAST_MERGE_MAX_DURATION_SECS &&
      (current.text.length + 1 + next.text.length) <= FAST_MERGE_MAX_CHARS;

    if (canMerge) {
      current.text = `${current.text} ${next.text}`.trim();
      current.end = Math.min(totalDuration, next.end);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged.map((seg, idx) => ({ ...seg, id: idx }));
}

function estimateDuration(audioPath) {
  const audioFileSize = fs.statSync(audioPath).size;
  return Math.max(10, Math.round(audioFileSize / 16000 / 2));
}

function sanitizeTime(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return fallback;
}

function getMockSegments(audioPath) {
  // Generate mock segments covering ENTIRE video for full dubbing
  const audioFileSize = fs.statSync(audioPath).size;
  const estimatedDuration = Math.round(audioFileSize / 16000 / 2);

  const segments = [];
  let currentTime = 0;
  let segmentCount = 0;

  // 10-second segments with NO gaps - covers entire video
  while (currentTime < estimatedDuration) {
    const segmentDuration = Math.min(10, estimatedDuration - currentTime);
    const end = currentTime + segmentDuration;

    if (segmentDuration > 0) {
      segments.push({
        id: segmentCount,
        start: currentTime,
        end: end,
        text: `[Segment ${segmentCount + 1}] Dubbing for entire video`
      });
    }

    currentTime = end;
    segmentCount++;
  }

  if (segments.length === 0) {
    segments.push({
      id: 0,
      start: 0,
      end: estimatedDuration || 10,
      text: '[Full video dubbing]'
    });
  }

  console.log(`✓ Generated ${segments.length} mock segments covering entire ${estimatedDuration}s video`);
  return segments;
}

module.exports = { transcribeAudio };
