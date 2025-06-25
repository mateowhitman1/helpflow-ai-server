/* processRecording.js
   -------------------------------------------------------------
   Twilio recording → Whisper → GPT-4 Turbo → ElevenLabs TTS
   + Airtable log → Twilio playback
-------------------------------------------------------------*/

import { File } from "node:buffer";           // Whisper needs global File
if (!globalThis.File) globalThis.File = File;

import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { OpenAI } from "openai";
import twilioPkg from "twilio";

import clientConfig          from "./client-config.js";
import { generateSpeech }    from "./utils/elevenlabs.js";
import { logCallToAirtable } from "./utils/airtable.js";

const twilio = twilioPkg;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* -------------------------------------------------------------
   Helper: build absolute URL for Twilio <Play> (needs https)
-------------------------------------------------------------*/
function absoluteUrl(req, relativePath) {
  const host = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
  return host + relativePath;          // relativePath already starts with “/”
}

/* -------------------------------------------------------------
   Main handler exported to server.js
-------------------------------------------------------------*/
export async function handleRecording(req, res) {
  const { client: clientId = "helpflow" } = req.query;
  const cfg = clientConfig.clients?.[clientId];
  if (!cfg) return res.status(400).send("Unknown client ID");

  const { RecordingUrl, From, CallSid, CallStatus } = req.body;

  let reply = "Sorry, something went wrong. Please try again later.";

  try {
    /* 1️⃣  Download caller audio ---------------------------------------- */
    const tmpFile = `/tmp/${CallSid}.mp3`;
    const audio   = await axios({
      method: "GET",
      url:    `${RecordingUrl}.mp3`,
      responseType: "stream",
      auth: {                        // Twilio basic-auth
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
    });
    await new Promise((resolve, reject) => {
      const w = fs.createWriteStream(tmpFile);
      audio.data.pipe(w);
      w.on("finish", resolve);
      w.on("error",  reject);
    });

    /* 2️⃣  Whisper transcription --------------------------------------- */
    const tr = await openai.audio.transcriptions.create({
      file : fs.createReadStream(tmpFile),
      model: "whisper-1",
    });
    const transcript = tr.text.trim();
    console.log("📝 transcript:", transcript);

    /* 3️⃣  GPT-4 Turbo reply ------------------------------------------- */
    const chat = await openai.chat.completions.create({
      model:       "gpt-4o-mini",     // fast Turbo variant
      temperature: 0.6,
      max_tokens : 120,
      messages: [
        { role: "system", content: cfg.scripts.systemPrompt },
        { role: "user",   content: transcript },
      ],
    });
    reply = chat.choices[0].message.content.trim();
    console.log("💬 GPT reply:", reply);

    /* 4️⃣  ElevenLabs TTS --------------------------------------------- */
    const voiceId = process.env.ELEVENLABS_VOICE_ID || cfg.voiceId;
    const relPath = await generateSpeech(reply, voiceId, CallSid);
    const playUrl = absoluteUrl(req, relPath);
    console.log("🔊 TTS saved:", playUrl);

    /* 5️⃣  Airtable log ----------------------------------------------- */
    await logCallToAirtable({
      callId:       CallSid,
      client:       clientId,
      callerNumber: From,
      dateTime:     new Date(),
      callStatus:   CallStatus,
      recordingUrl: `${RecordingUrl}.mp3`,
      transcript,
      intent:  "",          // placeholder
      outcome: reply,
    });

    /* 6️⃣  Twilio response -------------------------------------------- */
    const vr = new twilio.twiml.VoiceResponse();
    vr.play(playUrl);
    vr.redirect(`/voice?client=${clientId}`);
    res.type("text/xml").send(vr.toString());
  } catch (err) {
    console.error("❌ processRecording error:", err);

    // Fail-soft: speak the reply with Twilio’s built-in voice
    try {
      const vr = new twilio.twiml.VoiceResponse();
      vr.say(reply);
      res.type("text/xml").send(vr.toString());
    } catch {
      res.status(500).send("Error processing call");
    }
  } finally {
    // Clean up tmp file
    try { fs.unlinkSync(`/tmp/${CallSid}.mp3`); } catch {}
  }
}
