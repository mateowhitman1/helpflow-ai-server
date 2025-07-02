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

// Helper to build RAG prompt
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

// Cache for greetings
const GREET_CACHE = new Map();

// Pre-generate and cache greeting TTS
async function getGreeting(clientId) {
  if (GREET_CACHE.has(clientId)) return GREET_CACHE.get(clientId);
  const cfg = await getClientConfig(clientId);
  const greetingText = `Hello, thank you for calling ${cfg.botName}. How can I help you today?`;
  const relPath = await generateSpeech(greetingText, cfg.voiceId, `greeting-${clientId}`, cfg.modelId);
  const fullUrl = new URL(relPath, process.env.PUBLIC_BASE_URL).href;
  GREET_CACHE.set(clientId, fullUrl);
  return fullUrl;
}

// Initial call - play TTS greeting and gather input
app.post('/voice', async (req, res) => {
  const { client: clientId = 'helpflow' } = req.query;
  const vr = new VoiceResponse();

  // Play cached greeting
  const greetUrl = await getGreeting(clientId);
  vr.play(greetUrl);

  // Gather user speech
  const cfg = await getClientConfig(clientId);
  vr.gather({
    input: 'speech',
    action: `/process-recording?client=${clientId}`,
    method: 'POST',
    timeout: cfg.gatherTimeout,
    speechTimeout: 'auto'
  });

  // Fallback if no speech
  const fallbackText = "Sorry, I didn't hear anything. Goodbye.";
  const fallbackPath = await generateSpeech(fallbackText, cfg.voiceId, `fallback-${clientId}`, cfg.modelId);
  vr.play(fallbackPath);
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

    // Fetch client system prompt
    const cfg = await getClientConfig(client);
    const systemPrompt = cfg.systemPrompt;

    // Embed query
    const embRes = await openai.embeddings.create({ model: 'text-embedding-ada-002', input: query });
    const queryEmbed = embRes.data[0].embedding;

    // Vector search
    const vs = makeVectorStore(client);
    const results = await vs.search(queryEmbed, cfg.topK || 5);
    const contextText = results.map((r, i) => `Context ${i+1}: ${r.chunk.text}`).join('\n\n');

    // GPT completion
    const prompt = buildRagPrompt(systemPrompt, contextText, query);
    const chatRes = await openai.chat.completions.create({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }] });
    const reply = chatRes.choices[0].message.content;

    res.json({ client, query, context: results, reply });
  } catch (err) {
    console.error('/search-local error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server listening on port ${port}`));
