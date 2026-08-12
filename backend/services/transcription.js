const OpenAI = require('openai');
const fs = require('fs');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function transcribeAudio(audioPath) {
  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment']
  });

  return (response.segments || []).map(seg => ({
    id: seg.id,
    start: parseFloat(seg.start),
    end: parseFloat(seg.end),
    text: seg.text.trim()
  })).filter(seg => seg.text.length > 0);
}

module.exports = { transcribeAudio };
