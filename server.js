// server.js
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { OpenAI } from 'openai';
import pkg from 'twilio';
import { getClientConfig, registerMetricsEndpoint } from './client-config.js';
import { handleRecording } from './processRecording.js';
import { makeVectorStore } from './vectorStore.js';
import { generateSpeech } from './utils/elevenlabs.js';

// Twilio VoiceResponse helper
const { twiml } = pkg;
const { VoiceResponse } = twiml;

dotenv.config();
const app = express();

// Serve static audio files
const audioDir = path.join(process.cwd(), 'public', 'audio');
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
app.use('/audio', express.static(audioDir));

// Debug endpoint for audio files
app.get('/debug/audio', (req, res) => {
  fs.readdir(audioDir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot read audio directory', details: err.message });
    res.json({ files });
  });
});

// Parse JSON and form data
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Cache metrics endpoint
registerMetricsEndpoint(app);

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// RAG prompt builder
function buildRagPrompt(systemPrompt, contextText, userText) {
  return `
${systemPrompt}

---
CONTEXT (use only for answers):
${contextText}

---
TASK:
1. If the question can be answered using the context above, provide that answer verbatim.
2. Otherwise, respond naturally as a friendly assistant, without mentioning limitations.

QUESTION:
${userText}`.trim();
}

// TTS cache
const TTS_CACHE = { greeting: new Map(), retry: new Map(), fallback: new Map(), goodbye: new Map() };

async function getTts(clientId, type, text, filenameSuffix) {
  const cache = TTS_CACHE[type];
  if (cache.has(clientId)) return cache.get(clientId);
  const cfg = await getClientConfig(clientId);
  const filename = `${type}-${clientId}${filenameSuffix ? '-' + filenameSuffix : ''}`;
  const relPath = await generateSpeech(text, cfg.voiceId, filename, cfg.modelId);
  const fullUrl = new URL(relPath, process.env.PUBLIC_BASE_URL).href;
  cache.set(clientId, fullUrl);
  return fullUrl;
}

// Initial call - play TTS greeting and gather input
app.post('/voice', async (req, res) => {
  const { client: clientId = 'helpflow' } = req.query;
  const vr = new VoiceResponse();

  // 1) Greeting
  const cfg = await getClientConfig(clientId);
  const greetText = `Hello, thank you for calling ${cfg.botName}. How can I help you today?`;
  const greetUrl = await getTts(clientId, 'greeting', greetText);
  vr.play(greetUrl);

  // 2) Gather user speech with optimized recording settings
  vr.gather({
    input: 'speech',
    action: `/process-recording?client=${clientId}`,
    method: 'POST',
    timeout: cfg.gatherTimeout,
    speechTimeout: 'auto',
    recordingChannels: 'mono',
    bitRate: '32k'
  });

  // 3) Fallback
  const fallbackText = "Sorry, I didn't hear anything. Goodbye.";
  const fallbackUrl = await getTts(clientId, 'fallback', fallbackText);
  vr.play(fallbackUrl);
  vr.hangup();

  res.type('text/xml').send(vr.toString());
});

// Recording handler
app.post('/process-recording', handleRecording);

// Standalone RAG endpoint
app.post('/search-local', async (req, res) => {
  try {
    const { client, query } = req.body;
    if (!client || !query) return res.status(400).json({ error: 'Missing client or query' });

    const cfg = await getClientConfig(client);
    const systemPrompt = cfg.systemPrompt;

    // Embed query
    const emb = await openai.embeddings.create({ model: 'text-embedding-ada-002', input: query });
    const queryEmbed = emb.data[0].embedding;

    // Vector search
    const vs = makeVectorStore(client);
    const results = await vs.search(queryEmbed, cfg.topK || 3);
    const contextText = results.map((r,i) => `Context ${i+1}: ${r.chunk.text}`).join('\n\n');

    // GPT completion
    const prompt = buildRagPrompt(systemPrompt, contextText, query);
    const chat = await openai.chat.completions.create({ model: 'gpt-3.5-turbo', messages: [{ role:'user', content: prompt }] });
    const reply = chat.choices[0].message.content;

    res.json({ client, query, context: results, reply });
  } catch (err) {
    console.error('/search-local error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server listening on port ${port}`));
