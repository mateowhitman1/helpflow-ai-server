// processRecording.js
/* 
   -------------------------------------------------------------
   Twilio recording → Whisper → RAG-enhanced GPT → ElevenLabs TTS
   + Airtable log → Twilio playback (with Gather for next turn)
-------------------------------------------------------------*/

import { File } from "node:buffer";
if (!globalThis.File) globalThis.File = File;

import os from "os";
import axios from "axios";
import fs from "fs";
import path from "path";
import { OpenAI } from "openai";
import twilioPkg from "twilio";
import { getClientConfig } from "./client-config.js";
import { generateSpeech } from "./utils/elevenlabs.js";
import { logCallToAirtable } from "./utils/airtable.js";
import { search } from "./vectorStore.js";

const twilio = twilioPkg;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Builds full URL for static assets
function absoluteUrl(relativePath) {
  const host = process.env.PUBLIC_BASE_URL;
  return host + relativePath;
}

export async function handleRecording(req, res) {
  const { client: clientId = "helpflow" } = req.query;
  // Load dynamic client config
  const cfg = await getClientConfig(clientId);
  if (!cfg) return res.status(400).send("Unknown client ID");

  const { RecordingUrl, From, CallSid, CallStatus, SpeechResult } = req.body;

  // Handle Gather follow-up (no new recording)
  if (!RecordingUrl) {
    console.log("🛠️ Gather callback, SpeechResult=", SpeechResult);
    const followChat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      max_tokens: 120,
      messages: [
        { role: "system", content: cfg.systemPrompt },
        { role: "user", content: SpeechResult },
      ],
    });
    const followUp = followChat.choices[0].message.content.trim();

    const voiceId2 = process.env.ELEVENLABS_VOICE_ID || cfg.voiceId;
    const relPath2 = await generateSpeech(followUp, voiceId2, `${CallSid}-followup`);
    const playUrl2 = absoluteUrl(relPath2);

    const vr2 = new twilio.twiml.VoiceResponse();
    vr2.play(playUrl2);
    vr2.say("Thank you for calling ${cfg.botName}. Goodbye!");
    vr2.hangup();
    return res.type("text/xml").send(vr2.toString());
  }

  let reply = "Sorry, something went wrong.";
  const tmpFile = path.join(os.tmpdir(), `${CallSid}.mp3`);

  try {
    // 1️⃣ Download audio
    const audioUrl = RecordingUrl.endsWith('.mp3') ? RecordingUrl : `${RecordingUrl}.mp3`;
    console.log('🛠️ [process-recording] Downloading from:', audioUrl);
    const axiosConfig = { responseType: 'stream' };
    if (audioUrl.includes('twilio.com')) {
      axiosConfig.auth = {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      };
    }
    const audio = await axios.get(audioUrl, axiosConfig);
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(tmpFile);
      audio.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    // 2️⃣ Whisper transcription
    const transcriptionRes = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "whisper-1",
    });
    const transcript = transcriptionRes.text.trim();
    console.log("📝 transcript:", transcript);

    // 2.5️⃣ RAG-enhanced context retrieval
    const embRes = await openai.embeddings.create({ model: 'text-embedding-ada-002', input: transcript });
    const queryEmbed = embRes.data[0].embedding;
    const ctxResults = await search(queryEmbed, 3);
    const contextText = ctxResults.map((r, i) => `Context ${i+1}: ${r.chunk.text}`).join('\n\n');
    console.log("🛠️ Retrieved context:\n", contextText);

    // 3️⃣ GPT reply with context
    const chatRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      max_tokens: 120,
      messages: [
        { role: "system", content: cfg.systemPrompt },
        { role: "system", content: `Use the context below to answer user:\n${contextText}` },
        { role: "user", content: transcript },
      ],
    });
    reply = chatRes.choices[0].message.content.trim();
    console.log("💬 GPT reply:", reply);

    // 4️⃣ ElevenLabs TTS
    const voiceId = process.env.ELEVENLABS_VOICE_ID || cfg.voiceId;
    const relPath = await generateSpeech(reply, voiceId, CallSid);
    const playUrl = absoluteUrl(relPath);

    // 5️⃣ Airtable logging
    await logCallToAirtable({
      callId: CallSid,
      client: clientId,
      callerNumber: From,
      dateTime: new Date(),
      callStatus: CallStatus,
      recordingUrl: audioUrl,
      transcript,
      intent: "",
      outcome: reply,
    });

    // 6️⃣ TwiML response
    const vr = new twilio.twiml.VoiceResponse();
    vr.play(playUrl);
    vr.gather({ input: "speech", action: `/process-recording?client=${clientId}`, timeout: cfg.gatherTimeout });
    vr.say(`Thank you for calling ${cfg.botName}. Goodbye!`);
    vr.hangup();

    console.log("🛠️ TwiML response:\n", vr.toString());
    return res.type("text/xml").send(vr.toString());
  } catch (err) {
    console.error("❌ processRecording error:", err);
    try {
      const vrErr = new twilio.twiml.VoiceResponse();
      vrErr.say(reply);
      return res.type("text/xml").send(vrErr.toString());
    } catch {
      return res.status(500).send("Error processing call");
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}
