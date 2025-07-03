/* 
   -------------------------------------------------------------
   Twilio recording → Whisper → RAG-enhanced GPT → ElevenLabs TTS
   + Airtable log → Twilio playback (with Gather for next turn)
-------------------------------------------------------------*/

// Ensure File global for OpenAI uploads
import { File } from 'node:buffer';
if (!globalThis.File) globalThis.File = File;

import os from "os";
import axios from "axios";
import fs from "fs";
import path from "path";
import { OpenAI } from "openai";
import pkg from "twilio";
import { LRUCache } from "lru-cache";
import { getClientConfig } from "./client-config.js";
import { makeVectorStore } from "./vectorStore.js";
import { generateSpeech } from "./utils/elevenlabs.js";
import { logCallToAirtable } from "./utils/airtable.js";
import { getSession, saveSession, clearSession } from "./session-store.js";

const { VoiceResponse } = pkg.twiml;
const DEFAULT_MODEL = "gpt-3.5-turbo";
const DEFAULT_MAX_TOKENS = 80;

// In-memory cache for embeddings
const embedCache = new LRUCache({ max: 100, ttl: 5 * 60 * 1000 });  // 5 min TTL

// Thinking TTS pre-warm
let thinkingAudioUrl;
(async () => {
  try {
    const cfg = await getClientConfig('helpflow');
    const rel = await generateSpeech('One moment please…', cfg.voiceId, 'thinking', cfg.modelId);
    thinkingAudioUrl = new URL(rel, process.env.PUBLIC_BASE_URL).href;
  } catch {}
})();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Build a unified RAG + freeform prompt
 */
function buildRagPrompt(systemPrompt, contextText, userText) {
  return `${systemPrompt}

---
CONTEXT (use only for answers):
${contextText}

---
TASK:
1. If the user's question can be answered using the context above, provide that answer verbatim.
2. Otherwise, respond naturally as a friendly assistant, engaging conversationally without stating limitations.

QUESTION:
${userText}`.trim();
}

function absoluteUrl(relativePath) {
  return new URL(relativePath, process.env.PUBLIC_BASE_URL).href;
}

export async function handleRecording(req, res) {
  const sid = req.body.CallSid;
  // Parallel fetch session and play thinking audio
  const sessionPromise = getSession(sid);
  if (thinkingAudioUrl) {
    const vrThinking = new VoiceResponse();
    vrThinking.play(thinkingAudioUrl);
    res.type('text/xml').send(vrThinking.toString());
  }
  const session = await sessionPromise;

  const { client: clientId = 'helpflow' } = req.query;
  const cfg = await getClientConfig(clientId);
  if (!cfg) return res.status(400).send('Unknown client');

  const vs = makeVectorStore(clientId);
  const { RecordingUrl, From, CallStatus, SpeechResult } = req.body;

  // Handle follow-up (no new recording)
  if (!RecordingUrl) {
    const vr = new VoiceResponse();
    if (!SpeechResult) {
      const msg = 'Sorry, I didn\'t catch that. Could you please repeat?';
      const tts = await generateSpeech(msg, cfg.voiceId, `${sid}-retry`, cfg.modelId);
      vr.play(absoluteUrl(tts));
      vr.record({ action: `/process-recording?client=${clientId}`, method: 'POST', maxLength: cfg.maxRecordingLength || 60, playBeep: false });
      return res.type('text/xml').send(vr.toString());
    }
    const prompt = buildRagPrompt(cfg.systemPrompt, '', SpeechResult);
    const model = session.history.length === 0 ? (cfg.model || DEFAULT_MODEL) : DEFAULT_MODEL;
    const chat = await openai.chat.completions.create({ model, temperature: cfg.temperature ?? 0.6, max_tokens: cfg.maxTokens ?? DEFAULT_MAX_TOKENS, messages: [{ role: 'user', content: prompt }] });
    const followup = chat.choices[0].message.content.trim();

    session.history.push({ user: SpeechResult, assistant: followup });
    await saveSession(sid, session);

    const ttsFollow = await generateSpeech(followup, cfg.voiceId, `${sid}-follow`, cfg.modelId);
    vr.play(absoluteUrl(ttsFollow));
    vr.gather({ input: 'speech', action: `/process-recording?client=${clientId}`, timeout: cfg.gatherTimeout, speechTimeout: 'auto' });
    return res.type('text/xml').send(vr.toString());
  }

  // Download & transcribe
  const tmp = path.join(os.tmpdir(), `${sid}.mp3`);
  const audioUrl = RecordingUrl.endsWith('.mp3') ? RecordingUrl : `${RecordingUrl}.mp3`;
  const opts = { responseType: 'stream' };
  if (audioUrl.includes('twilio.com')) opts.auth = { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN };
  const download = axios.get(audioUrl, opts).then(resp => new Promise((r, e) => { const w = fs.createWriteStream(tmp); resp.data.pipe(w); w.on('finish', r); w.on('error', e); }));
  await download;
  const tr = await openai.audio.transcriptions.create({ file: fs.createReadStream(tmp), model: 'whisper-1' });
  const transcript = tr.text.trim();

  // Embedding cache
  let embedding = embedCache.get(transcript);
  if (!embedding) {
    const embRes = await openai.embeddings.create({ model: 'text-embedding-ada-002', input: transcript });
    embedding = embRes.data[0].embedding;
    embedCache.set(transcript, embedding);
  }
  const results = await vs.search(embedding, cfg.topK || 3);
  const contextText = results.map((r, i) => `Context ${i+1}: ${r.chunk.text}`).join('\n\n');

  // GPT call with dynamic model
  const model = session.history.length === 0 ? (cfg.model || DEFAULT_MODEL) : DEFAULT_MODEL;
  const prompt = buildRagPrompt(cfg.systemPrompt, contextText, transcript);
  const chatRes = await openai.chat.completions.create({ model, temperature: cfg.temperature ?? 0.6, max_tokens: cfg.maxTokens ?? DEFAULT_MAX_TOKENS, messages: [{ role: 'user', content: prompt }] });
  const reply = chatRes.choices[0].message.content.trim();

  session.history.push({ user: transcript, assistant: reply });
  await saveSession(sid, session);

  const ttsReply = await generateSpeech(reply, cfg.voiceId, sid, cfg.modelId);
  await logCallToAirtable({ callId: sid, client: clientId, callerNumber: From, dateTime: new Date(), callStatus: CallStatus, recordingUrl: audioUrl, transcript, intent: '', outcome: reply });

  const vr2 = new VoiceResponse();
  vr2.play(absoluteUrl(ttsReply));
  vr2.gather({ input: 'speech', action: `/process-recording?client=${clientId}`, timeout: cfg.gatherTimeout, speechTimeout: 'auto' });
  return res.type('text/xml').send(vr2.toString());
}
