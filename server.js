//server.js
// Main server file for HelpFlow AI 

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { OpenAI } from 'openai';
import pkg from 'twilio';
import { getClientConfig, registerMetricsEndpoint } from './client-config.js';
import { makeVectorStore } from './vectorStore.js';
import { generateSpeech } from './utils/elevenlabs.js';
import { handleRecording } from './processRecording.js';

dotenv.config();
const app = express();

// Twilio VoiceResponse helper
const { twiml } = pkg;
const { VoiceResponse } = twiml;

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

// In-memory caches
const TTS_CACHE = { greeting: new Map(), fallback: new Map(), goodbye: new Map() };
const VS_CACHE = new Map();

export function getVectorStore(clientId) {
  if (!VS_CACHE.has(clientId)) VS_CACHE.set(clientId, makeVectorStore(clientId));
  return VS_CACHE.get(clientId);
}

// Helper: get or generate TTS and URL with quality settings
async function getTts(clientId, type, text) {
  const cache = TTS_CACHE[type];
  if (cache.has(clientId)) return cache.get(clientId);
  const cfg = await getClientConfig(clientId);
  const voiceCfg = cfg.voices[cfg.settings.defaultVoiceName] || { voiceId: cfg.voiceId, model: cfg.modelId };
  const { stability, similarity, voiceSpeed } = cfg.settings;
  const filename = `${type}-${clientId}`;
  const relPath = await generateSpeech(text, voiceCfg.voiceId, filename, { modelId: voiceCfg.model, stability, similarity, voiceSpeed });
  const fullUrl = new URL(relPath, process.env.PUBLIC_BASE_URL).href;
  cache.set(clientId, fullUrl);
  return fullUrl;
}

// 1️⃣ Incoming call webhook with barge-in support
app.post('/voice', async (req, res) => {
  const { client: clientId = 'helpflow' } = req.query;
  const cfg = await getClientConfig(clientId);
  const vr = new VoiceResponse();

  // Prepare greeting and fallback URLs
  const greetText = cfg.scripts['greeting'] || `Hello, thank you for calling ${cfg.botName}. How can I help you today?`;
  const greetUrl = await getTts(clientId, 'greeting', greetText);
  const fallbackText = cfg.scripts['fallback'] || "Sorry, I didn't hear anything. Goodbye.";
  const fallbackUrl = await getTts(clientId, 'fallback', fallbackText);

  // Gather with barge-in: caller can interrupt the greeting
  vr.gather({
    input: 'speech',
    action: `/process-recording?client=${clientId}`,
    method: 'POST',
    timeout: cfg.gatherTimeout,
    speechTimeout: 'auto',
    recordingChannels: 'mono',
    bitRate: '32k',
    bargeIn: true
  })
    .play(greetUrl);

  // Fallback if no speech detected
  vr.play(fallbackUrl);
  vr.hangup();

  res.type('text/xml').send(vr.toString());
});

// 2️⃣ Process recording & reply
app.post('/process-recording', async (req, res) => {
  const { client: clientId = 'helpflow' } = req.query;
  const cfg = await getClientConfig(clientId);
  const vs = getVectorStore(clientId);
  await handleRecording(req, res, { cfg, openai, vs, generateSpeech });
});

// 3️⃣ Standalone RAG endpoint
app.post('/search-local', async (req, res) => {
  try {
    const { client, query } = req.body;
    if (!client || !query) return res.status(400).json({ error: 'Missing client or query' });

    const cfg = await getClientConfig(client);
    const emb = await openai.embeddings.create({ model: 'text-embedding-ada-002', input: query });
    const queryEmbed = emb.data[0].embedding;
    const vs = getVectorStore(client);
    const results = await vs.search(queryEmbed, cfg.topK || 3);
    const contextText = results.map((r, i) => `Context ${i+1}: ${r.chunk.text}`).join('\n\n');

    const prompt = `
${cfg.systemPrompt}

---
CONTEXT (use only for answers):
${contextText}

---
TASK:
1. If the question can be answered using the context above, provide that answer verbatim.
2. Otherwise, respond naturally as a friendly assistant, without mentioning limitations.

QUESTION:
${query}`.trim();

    const chat = await openai.chat.completions.create({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }] });
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
