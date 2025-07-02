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
If the question can be answered using the context above, provide that answer verbatim. Otherwise, respond conversationally, but do not invent unsupported policies.

QUESTION:
${userText}`.trim();
}

// Fetch client config
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

// Initial call - gather user input
app.post('/voice', (req, res) => {
  const vr = new VoiceResponse();
  vr.say('Hello, thank you for calling HelpFlow AI. How can I help you today?');
  vr.gather({ input: 'speech', action: '/process-recording', method: 'POST', timeout: 5, speechTimeout: 'auto' });
  vr.say('I did not hear anything. Goodbye.');
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

    // Embed query
    const embRes = await openai.embeddings.create({ model: 'text-embedding-ada-002', input: query });
    const queryEmbed = embRes.data[0].embedding;

    // Vector search
    const vs = makeVectorStore(client);
    const results = await vs.search(queryEmbed, 5);
    const contextText = results.map((r, i) => `Context ${i+1}: ${r.chunk.text}`).join('\n\n');

    // GPT completion
    const prompt = buildRagPrompt('Use the context below to answer the user:', contextText, query);
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
