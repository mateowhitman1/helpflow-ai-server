// server.js
import express from 'express';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { getClientConfig, registerMetricsEndpoint } from './client-config.js';
import { handleRecording } from './processRecording.js';
import { search } from './vectorStore.js';
// If you’ve extracted session logic, import it too (optional here):
// import './session-store.js';

dotenv.config();
const app = express();

// Parse JSON bodies (for /search-local, /config, etc.)
app.use(express.json());
// Parse x-www-form-urlencoded bodies (Twilio will POST form data)
app.use(express.urlencoded({ extended: false }));

// Expose cache metrics for client-config
registerMetricsEndpoint(app);

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper to build a consistent RAG prompt
function buildRagPrompt(systemPrompt, contextText, userText) {
  return `
${systemPrompt}

Context:
${contextText}

User:
${userText}`.trim();
}

// Config fetch route
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

// Twilio incoming-call webhook — handle both /voice and /process-recording
app.post('/voice', handleRecording);
app.post('/process-recording', handleRecording);

// Standalone RAG endpoint
app.post('/search-local', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    // 1) Embed the user query
    const embRes = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: query,
    });
    const queryEmbed = embRes.data[0].embedding;

    // 2) Retrieve top-5 context chunks
    const results = await search(queryEmbed, 5);
    const contextText = results
      .map((r, i) => `Context ${i + 1}: ${r.chunk.text}`)
      .join('\n\n');

    // 3) Build and call GPT
    const prompt = buildRagPrompt(
      'Use the context below to answer the user:',
      contextText,
      query
    );
    const chatRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
    });
    const reply = chatRes.choices[0].message.content;

    return res.json({ query, context: results, reply });
  } catch (err) {
    console.error('/search-local error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server listening on port ${port}`));
