const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Translate segments in batches to reduce API calls
async function translateToHindi(segments) {
  const BATCH_SIZE = 15;
  const results = [];

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const numbered = batch.map((s, idx) => `[${idx + 1}] ${s.text}`).join('\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            'Translate each numbered text segment to natural spoken Hindi (Devanagari script). ' +
            'Preserve the numbering format exactly. Output only the translated segments, nothing else. ' +
            'Keep the same emotional tone and speaking style.'
        },
        { role: 'user', content: numbered }
      ]
    });

    const lines = response.choices[0].message.content
      .split('\n')
      .filter(l => l.trim());

    batch.forEach((seg, idx) => {
      // Strip the leading [N] marker from the response line
      const line = lines[idx] || '';
      const hindiText = line.replace(/^\[\d+\]\s*/, '').trim();
      results.push({ ...seg, hindiText: hindiText || seg.text });
    });
  }

  return results;
}

module.exports = { translateToHindi };
