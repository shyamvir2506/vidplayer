const axios = require('axios');
const https = require('https');
const { pipeline } = require('@xenova/transformers');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const TRANSLATION_PROVIDER = (process.env.TRANSLATION_PROVIDER || 'google').toLowerCase();

// Lazy-loaded local fallback model.
let translator = null;

async function getTranslator() {
  if (!translator) {
    console.log('Loading NLLB translation model (first run ~2-3 min)...');
    translator = await pipeline('translation', 'Xenova/nllb-200-distilled-600M');
  }
  return translator;
}

async function translateWithGoogle(text) {
  const url = 'https://translate.googleapis.com/translate_a/single';
  const params = {
    client: 'gtx',
    sl: 'en',
    tl: 'hi',
    dt: 't',
    q: text
  };

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios.get(url, {
        params,
        timeout: 10000,
        httpsAgent,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'
        }
      });

      const data = response.data;
      if (!Array.isArray(data) || !Array.isArray(data[0])) {
        throw new Error('Unexpected translation response format');
      }

      return data[0].map((item) => item?.[0] || '').join('').trim() || text;
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }

  throw lastErr || new Error('Google translation failed');
}

async function translateSegmentsWithGoogle(segments, onProgress) {
  const BATCH_SIZE = 20;
  const results = [];
  const totalBatches = Math.ceil(segments.length / BATCH_SIZE);

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`Fast translation batch ${currentBatch}/${totalBatches}`);

    if (typeof onProgress === 'function') {
      const translatedRatio = (currentBatch - 1) / totalBatches;
      const progress = 50 + Math.round(translatedRatio * 15);
      onProgress(progress, `Translating to Hindi (fast mode)... (${currentBatch}/${totalBatches})`);
    }

    const translatedBatch = await Promise.all(
      batch.map(async (seg) => {
        try {
          const hindiText = await translateWithGoogle(seg.text);
          return { ...seg, hindiText };
        } catch (err) {
          console.warn(`Fast translation failed for segment ${seg.id}:`, err.message);
          return { ...seg, hindiText: seg.text };
        }
      })
    );

    results.push(...translatedBatch);
  }

  if (typeof onProgress === 'function') {
    onProgress(65, 'Translation complete. Generating Hindi voice...');
  }

  return results;
}

async function translateSegmentsWithNllb(segments, onProgress) {
  const BATCH_SIZE = 10;
  const results = [];
  const model = await getTranslator();
  const totalBatches = Math.ceil(segments.length / BATCH_SIZE);

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`NLLB translation batch ${currentBatch}/${totalBatches}`);

    if (typeof onProgress === 'function') {
      const translatedRatio = (currentBatch - 1) / totalBatches;
      const progress = 50 + Math.round(translatedRatio * 15);
      onProgress(progress, `Translating to Hindi (NLLB)... (${currentBatch}/${totalBatches})`);
    }

    try {
      const texts = batch.map((seg) => seg.text);
      const outputs = await model(texts, {
        src_lang: 'eng_Latn',
        tgt_lang: 'hin_Deva'
      });

      for (let j = 0; j < batch.length; j++) {
        const seg = batch[j];
        const translated = outputs?.[j]?.translation_text;
        const hindiText = (translated || seg.text).trim();
        results.push({ ...seg, hindiText });
      }
    } catch (err) {
      console.warn(`NLLB batch ${currentBatch} failed:`, err.message);
      for (const seg of batch) {
        try {
          const output = await model(seg.text, {
            src_lang: 'eng_Latn',
            tgt_lang: 'hin_Deva'
          });
          const hindiText = (output?.[0]?.translation_text || seg.text).trim();
          results.push({ ...seg, hindiText });
        } catch (singleErr) {
          console.warn(`NLLB translation failed for segment ${seg.id}:`, singleErr.message);
          results.push({ ...seg, hindiText: seg.text });
        }
      }
    }
  }

  if (typeof onProgress === 'function') {
    onProgress(65, 'Translation complete. Generating Hindi voice...');
  }

  return results;
}

async function translateToHindi(segments, onProgress) {
  if (!segments || segments.length === 0) return [];

  if (TRANSLATION_PROVIDER === 'nllb') {
    return translateSegmentsWithNllb(segments, onProgress);
  }

  try {
    return await translateSegmentsWithGoogle(segments, onProgress);
  } catch (err) {
    console.warn('Fast translation unavailable, falling back to NLLB:', err.message);
    return translateSegmentsWithNllb(segments, onProgress);
  }
}

module.exports = { translateToHindi };
