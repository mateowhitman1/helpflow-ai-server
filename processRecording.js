//
   //-------------------------------------------------------------
   //Twilio recording → Whisper → RAG-enhanced GPT → ElevenLabs TTS
   //+ Airtable log → Twilio playback (with Gather for next turn)
//-------------------------------------------------------------*/

// Ensure File global for OpenAI uploads
import { File } from 'node:buffer';
if (!globalThis.File) globalThis.File = File;

import os from "os";
import axios from "axios";
import fs from "fs";
import path from "path";
import { OpenAI } from "openai";
import pkg from "twilio";
import { getClientConfig } from "./client-config.js";
import { makeVectorStore } from "./vectorStore.js";
import { generateSpeech } from "./utils/elevenlabs.js";
import { logCallToAirtable } from "./utils/airtable.js";
import { getSession, saveSession, clearSession } from "./session-store.js";

const { VoiceResponse } = pkg.twiml;
const DEFAULT_MODEL = "gpt-3.5-turbo";
const DEFAULT_MAX_TOKENS = 80;

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
2. Otherwise, respond naturally as a friendly assistant, engaging conversationally without stating limitations like \"I can't provide live data\" or refusing to answer.

QUESTION:
${userText}`.trim();
}

function absoluteUrl(relativePath) {
  return new URL(relativePath, process.env.PUBLIC_BASE_URL).href;
}

export async function handleRecording(req, res) {
  const sid = req.body.CallSid;
  const session = await getSession(sid);
  const { client: clientId = "helpflow" } = req.query;
  const cfg = await getClientConfig(clientId);
  if (!cfg) return res.status(400).send("Unknown client");

  // Initialize per-client vector store
  const vs = makeVectorStore(clientId);
  const { RecordingUrl, From, CallStatus, SpeechResult } = req.body;

  // 1) Handle follow-up without new recording
  if (!RecordingUrl) {
    const vr = new VoiceResponse();
    if (!SpeechResult) {
      const msg = "Sorry, I didn't catch that. Could you please repeat?";
      const ttsPath = await generateSpeech(msg, cfg.voiceId, `${sid}-retry`, cfg.modelId);
      vr.play(absoluteUrl(ttsPath));
      vr.record({ action: `/process-recording?client=${clientId}`, method: "POST", maxLength: cfg.maxRecordingLength || 60, playBeep: false });
      return res.type("text/xml").send(vr.toString());
    }

    // Compose unified prompt for follow-up
    const prompt = buildRagPrompt(
      cfg.systemPrompt,
      '', // no new context
      SpeechResult
    );
    const followChat = await openai.chat.completions.create({
      model: cfg.model || DEFAULT_MODEL,
      temperature: cfg.temperature ?? 0.6,
      max_tokens: cfg.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });
    const followup = followChat.choices[0].message.content.trim();

    session.history.push({ user: SpeechResult, assistant: followup });
    await saveSession(sid, session);

    const ttsFollow = await generateSpeech(followup, cfg.voiceId, `${sid}-follow`, cfg.modelId);
    vr.play(absoluteUrl(ttsFollow));
    vr.gather({ input: "speech", action: `/process-recording?client=${clientId}`, timeout: cfg.gatherTimeout });
    const goodbye = `Thank you for calling ${cfg.botName}. Goodbye!`;
    const ttsGoodbye = await generateSpeech(goodbye, cfg.voiceId, `${sid}-goodbye`, cfg.modelId);
    vr.play(absoluteUrl(ttsGoodbye));
    vr.hangup();
    return res.type("text/xml").send(vr.toString());
  }

  // 2) Download, transcribe, retrieve context, generate reply
  const tmp = path.join(os.tmpdir(), `${sid}.mp3`);
  try {
    const audioUrl = RecordingUrl.endsWith(".mp3") ? RecordingUrl : `${RecordingUrl}.mp3`;
    const opts = { responseType: "stream" };
    if (audioUrl.includes("twilio.com")) opts.auth = { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN };
    const resp = await axios.get(audioUrl, opts);
    await new Promise((r, e) => { const w = fs.createWriteStream(tmp); resp.data.pipe(w); w.on("finish", r); w.on("error", e); });

    const tr = await openai.audio.transcriptions.create({ file: fs.createReadStream(tmp), model: "whisper-1" });
    const transcript = tr.text.trim();

    // RAG: embed, search
    const embRes = await openai.embeddings.create({ model: 'text-embedding-ada-002', input: transcript });
    const results = await vs.search(embRes.data[0].embedding, cfg.topK || 3);
    const contextText = results.map((r, i) => `Context ${i + 1}: ${r.chunk.text}`).join("\n\n");

    // Compose unified prompt
    const prompt = buildRagPrompt(
      cfg.systemPrompt,
      contextText,
      transcript
    );
    const chatRes = await openai.chat.completions.create({
      model: cfg.model || DEFAULT_MODEL,
      temperature: cfg.temperature ?? 0.6,
      max_tokens: cfg.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });
    const reply = chatRes.choices[0].message.content.trim();

    session.history.push({ user: transcript, assistant: reply });
    await saveSession(sid, session);

    const ttsReply = await generateSpeech(reply, cfg.voiceId, sid, cfg.modelId);
    await logCallToAirtable({ callId: sid, client: clientId, callerNumber: From, dateTime: new Date(), callStatus: CallStatus, recordingUrl: audioUrl, transcript, intent: "", outcome: reply });

    const vr2 = new VoiceResponse();
    vr2.play(absoluteUrl(ttsReply));
    vr2.gather({ input: "speech", action: `/process-recording?client=${clientId}`, timeout: cfg.gatherTimeout });
    const bye = `Thank you for calling ${cfg.botName}. Goodbye!`;
    const ttsBye = await generateSpeech(bye, cfg.voiceId, `${sid}-bye`, cfg.modelId);
    vr2.play(absoluteUrl(ttsBye));
    vr2.hangup();
    return res.type("text/xml").send(vr2.toString());
  } catch (err) {
    console.error("processRecording error:", err);
    const vrErr = new VoiceResponse();
    const errorMsg = "Sorry, something went wrong.";
    const ttsErr = await generateSpeech(errorMsg, cfg.voiceId, `${sid}-error`, cfg.modelId);
    vrErr.play(absoluteUrl(ttsErr));
    vrErr.hangup();
    return res.type("text/xml").send(vrErr.toString());
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}
