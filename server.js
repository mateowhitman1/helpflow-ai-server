// server.js
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { OpenAI } from 'openai';
import pkg from 'twilio';
import { getClientConfig, registerMetricsEndpoint } from './client-config.js';
import { handleRecording } from './processRecording.js';
import { search } from './vectorStore.js';

dotenv.config();
const app = express();

// Configure audio directory for TTS files
const audioDir = path.join(process.cwd(), 'public', 'audio');
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
// Serve static audio files at /audio
app.use('/audio', express.static(audioDir));

// Debug endpoint: list audio files
app.get('/debug/audio', (req, res) => {
  fs.readdir(audioDir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot read audio directory', details: err.message });
    res.json({ files });
  });
});

// Parse incoming requests
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Expose cache metrics for client-config
registerMetricsEndpoint(app);

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper to build RAG prompt
function buildRagPrompt(systemPrompt, contextText, userText) {
  return `
${systemPrompt}

Context:
${contextText}

User:
${userText}`.trim();
}

// Config fetch
app.get('/config', async (req, res) => {
  const { client } = req.query;
  if (!client) return res.status(400).json({ error: 'Missing client param' });
  try {
    const cfg = await getClientConfig(client);
    res.json(cfg);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Initial Twilio webhook: prompt & record
app.post('/voice', (req, res) => {
  const { VoiceResponse } = pkg.twiml;
  const vr = new VoiceResponse();
  vr.say('Welcome to HelpFlow AI. Please ask your question after the beep.');
  vr.record({ action: '/process-recording', method: 'POST', maxLength: 60, playBeep: true });
  vr.hangup();
  res.type('text/xml').send(vr.toString());
});

// Post-recording handler
app.post('/process-recording', handleRecording);

// Standalone RAG endpoint
app.post('/search-local', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    // Embed & retrieve context
    const embRes = await openai.embeddings.create({ model: 'text-embedding-ada-002', input: query });
    const results = await search(embRes.data[0].embedding, 5);
    const contextText = results.map((r, i) => `Context ${i+1}: ${r.chunk.text}`).join('\n\n');

    // Build & call GPT
    const prompt = buildRagPrompt('Use the context below to answer the user:', contextText, query);
    const chatRes = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] });
    const reply = chatRes.choices[0].message.content;
    res.json({ query, context: results, reply });
  } catch (err) {
    console.error('/search-local error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server listening on port ${port}`));
