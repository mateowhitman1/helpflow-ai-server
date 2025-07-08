// Main server file for HelpFlow AI

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { OpenAI } from 'openai';
import pkg from 'twilio';
import { getClientConfig, registerMetricsEndpoint } from './client-config.js';
import { makeVectorStore } from './vectorStore.js';
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
const VS_CACHE = new Map();

export function getVectorStore(clientId) {
  if (!VS_CACHE.has(clientId)) VS_CACHE.set(clientId, makeVectorStore(clientId));
  return VS_CACHE.get(clientId);
}

// 📡 Low-latency TTS streaming proxy
app.get('/tts-stream/:client/:type', async (req, res) => {
  const { client: clientId, type } = req.params;
  try {
    const cfg = await getClientConfig(clientId);

    const fallbackDefault = type === 'greeting'
      ? `Hello, thank you for calling ${cfg.botName}. How can I help you today?`
      : "Sorry, I didn't hear anything. Goodbye.";

    const text = (type === 'greeting'
      ? cfg.scripts['greeting']
      : cfg.scripts['fallback']) || fallbackDefault;

    // ✅ Use client's default voice settings from Airtable
    const voiceCfg = cfg.voices[cfg.settings.defaultVoiceName] || {
      voiceId: cfg.voiceId,
      model: cfg.modelId || 'eleven_turbo_v2'
    };

    const voiceId = voiceCfg.voiceId;
    const modelId = voiceCfg.model || 'eleven_turbo_v2';
    const stability = parseFloat(cfg.settings.stability || 0.5);
    const similarity = parseFloat(cfg.settings.similarity || 0.75);

    // ✨ Full debug output of the request to ElevenLabs
    console.log('📤 ElevenLabs TTS full request →');
    console.log('URL:', `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`);
    console.log('Headers:', {
      'xi-api-key': '***',
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg'
    });
    console.log('Payload:', {
      text,
      model_id: modelId,
      voice_settings: { stability: stability, similarity_boost: similarity }
    });

    const llRes = await axios({
      method: 'post',
      url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      data: {
        text,
        model_id: modelId,
        voice_settings: { stability: stability, similarity_boost: similarity }
      },
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      responseType: 'stream',
      validateStatus: function (status) {
        return status < 500; // Resolve only if status is less than 500
      }
    });

    if (llRes.status !== 200) {
      console.error(`❌ ElevenLabs responded with status ${llRes.status}`);
      res.set('Content-Type', 'text/plain');
      res.status(502).send(`⚠️ ElevenLabs failed to stream TTS (voiceId: ${voiceId}). You may want to switch voices or check model compatibility.`);
      return;
    }

    res.set('Content-Type', 'audio/mpeg');
    llRes.data.pipe(res);
  } catch (err) {
    console.error('TTS stream error:', err.message);
    res.status(500).send();
  }
});

// 1⃣ Incoming call webhook with barge-in support
app.post('/voice', async (req, res) => {
  const { client: clientId = 'helpflow' } = req.query;
  const cfg = await getClientConfig(clientId);
  const vr = new VoiceResponse();

  // Use streaming endpoint for greeting
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
    .play(`${process.env.PUBLIC_BASE_URL}/tts-stream/${clientId}/greeting`);

  // Fallback if no speech detected
  vr.play(`${process.env.PUBLIC_BASE_URL}/tts-stream/${clientId}/fallback`);
  vr.hangup();

  res.type('text/xml').send(vr.toString());
});

// 2⃣ Process recording & reply
app.post('/process-recording', async (req, res) => {
  const { client: clientId = 'helpflow' } = req.query;
  const cfg = await getClientConfig(clientId);
  const vs = getVectorStore(clientId);
  await handleRecording(req, res, { cfg, openai, vs });
});

// 3⃣ Standalone RAG endpoint
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

// Start server with pre-generation
const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log(`✅ Server listening on port ${port}`);

  // Pre-generate TTS to cache
  const known = (process.env.KNOWN_CLIENTS || 'helpflow').split(',');
  for (const clientId of known) {
    try {
      const cfg = await getClientConfig(clientId);
      await axios.get(`${process.env.PUBLIC_BASE_URL}/tts-stream/${clientId}/greeting`);
      await axios.get(`${process.env.PUBLIC_BASE_URL}/tts-stream/${clientId}/fallback`);
      console.log(`🌆 Warmed TTS for ${clientId}`);
    } catch (e) {
      console.warn(`Failed to warm TTS for ${clientId}`, e.message);
    }
  }
});

