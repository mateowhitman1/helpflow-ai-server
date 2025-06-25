/* processRecording.js
   Handles Twilio recording → Whisper transcription → GPT-4 Turbo reply
   → ElevenLabs TTS → Airtable logging → Twilio playback */

import axios from "axios";
import fs from "fs";
import { OpenAI } from "openai";
import twilioPkg from "twilio";
import clientConfig from "./client-config.js";
import { generateSpeech } from "./utils/elevenlabs.js";
import { logCallToAirtable } from "./utils/airtable.js";

/* ---- polyfill File for Node 18 ---- */
import { File } from "node:buffer";
globalThis.File = File;                           // ⬅️ key line

const twilio = twilioPkg;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handleRecording(req, res) {
  const { client = "helpflow" } = req.query;
  const cfg = clientConfig.clients[client];
  const { RecordingUrl, From, CallSid } = req.body;

  try {
    /* 1️⃣ Download caller audio (requires Twilio auth) */
    const filePath = `/tmp/${CallSid}.mp3`;
    const audio = await axios({
      method: "GET",
      url: `${RecordingUrl}.mp3`,
      responseType: "stream",
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
    });
    await new Promise((resolve) => {
      const w = fs.createWriteStream(filePath);
      audio.data.pipe(w);
      w.on("finish", resolve);
    });

    /* 2️⃣ Transcribe via Whisper (File API) */
    const audioBuf  = fs.readFileSync(filePath);
    const audioFile = new File([audioBuf], `${CallSid}.mp3`, { type: "audio/mpeg" });
    const tr = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
    });
    const transcript = tr.text;
    console.log("📝 Transcript:", transcript);

    /* 3️⃣ GPT-4 Turbo reply */
    const gpt = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { role: "system", content: cfg.scripts.systemPrompt },
        { role: "user",   content: transcript },
      ],
    });
    const reply = gpt.choices[0].message.content;
    console.log("💬 GPT Reply:", reply);

    /* 4️⃣ ElevenLabs TTS */
    const audioUrl = await generateSpeech(reply, cfg.voiceId, CallSid);
    console.log("🔊 TTS ready:", audioUrl);

    /* 5️⃣ Log to Airtable */
    await logCallToAirtable({
      callId: CallSid,
      caller: From,
      transcript,
      intent: "",                // add intent parsing later
      outcome: reply,
      recordingUrl: `${RecordingUrl}.mp3`,
    });
    console.log("✅ Row saved to Airtable");

    /* 6️⃣ Respond to Twilio */
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.play(audioUrl);
    twiml.redirect(`/voice?client=${client}`);     // loop conversation

    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("❌ processRecording error:", err);
    res.status(500).send("Error processing call");
  }
}


