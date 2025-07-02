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

Here is some context from the client's knowledge base:
${contextText}

Instructions:
- If the user's question can be answered using the context above, use only that information.
- If the user's question is outside the context, have a natural, conversational response as a friendly AI assistant.

User's question:
${userText}`.trim();
}

Use ONLY the context below to answer the user's question. Do NOT hallucinate or provide information not contained in the context. If the answer isn't in the context, respond with "I don't know.".

Context:
${contextText}

Question:
${userText}`.trim();
}

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

// Initial Twilio webhook: prompt user via <Gather> for natural conversational flow
app.post('/voice', (req, res) => {
  const vr = new VoiceResponse();
  // Ask open-ended question and listen for speech
  vr.say('Hello, thank you for calling HelpFlow AI. How can I help you today?');
  vr.gather({
    input: 'speech',
    action: '/process-recording',
    method: 'POST',
    timeout: 5,
    speechTimeout: 'auto'
  });
  // If no speech detected
  vr.say('I did not hear anything. Goodbye.');
  vr.hangup();

  res.type('text/xml').send(vr.toString());
});

// Post-recording handler
app.post('/process-recording', handleRecording);

// Standalone RAG endpoint
app.post('/search-local', async (req, res) => {
  try {
    const { client, query } = req.body;
    if (!client || !query) return res.status(400).json({ error: 'Missing client or query' });

    // 1) Embed the user query
    const embRes = await openai.embeddings.create({ model: 'text-embedding-ada-002', input: query });
    const queryEmbed = embRes.data[0].embedding;

    // Initialize per-client vector store and search
    const vs = makeVectorStore(client);
    const results = await vs.search(queryEmbed, 5);
    const contextText = results.map((r, i) => `Context ${i+1}: ${r.chunk.text}`).join('\n\n');

    // 3) Build and call GPT
    const prompt = buildRagPrompt('Use the context below to answer the user:', contextText, query);
    const chatRes = await openai.chat.completions.create({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }] });
    const reply = chatRes.choices[0].message.content;

    return res.json({ client, query, context: results, reply });
  } catch (err) {
    console.error('/search-local error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server listening on port ${port}`));
