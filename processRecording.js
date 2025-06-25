/* processRecording.js
   Twilio recording → Whisper → GPT-4 Turbo → ElevenLabs TTS
   + Airtable log → Twilio playback
*/

import { File } from "node:buffer";           // Whisper needs global File
if (!globalThis.File) globalThis.File = File;

import axios from "axios";
import fs from "fs";
import { OpenAI } from "openai";
import twilioPkg from "twilio";
import clientConfig from "./client-config.js";
import { generateSpeech } from "./utils/elevenlabs.js";
import { logCallToAirtable } from "./utils/airtable.js";

const twilio = twilioPkg;
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handleRecording(req, res) {
  const { client = "helpflow" } = req.query;
  const cfg                       = clientConfig.clients[client];
  const { RecordingUrl, From, CallSid } = req.body;

  try {
    /* 1️⃣  download caller audio ------------------------------------------------ */
    const tmpFile = `/tmp/${CallSid}.mp3`;
    const audio   = await axios({
      method:       "GET",
      url:          `${RecordingUrl}.mp3`,
      responseType: "stream",
      auth: {                       // Twilio basic-auth
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
    });
    await new Promise(resolve => {
      const w = fs.createWriteStream(tmpFile);
      audio.data.pipe(w);
      w.on("finish", resolve);
    });

    /* 2️⃣  Whisper transcription ----------------------------------------------- */
    const tr        = await openai.audio.transcriptions.create({
      file : fs.createReadStream(tmpFile),
      model: "whisper-1",
    });
    const transcript = tr.text;
    console.log("📝 transcript:", transcript);

    /* 3️⃣  GPT-4 Turbo reply ---------------------------------------------------- */
    const gpt = await openai.chat.completions.create({
      model   : "gpt-4-turbo",
      messages: [
        { role: "system", content: cfg.scripts.systemPrompt },
        { role: "user",   content: transcript },
      ],
    });
    const reply = gpt.choices[0].message.content;
    console.log("💬 GPT reply:", reply);

    /* 4️⃣  ElevenLabs TTS  →  saved in  public/audio/<CallSid>.mp3  ------------- */
    const audioUrl = await generateSpeech(reply, cfg.voiceId, CallSid);   // <- NEW
    console.log("🔊 TTS saved:", audioUrl);

    /* 5️⃣  Airtable log --------------------------------------------------------- */
    await logCallToAirtable({
      callId      : CallSid,
      caller      : From,
      transcript,
      intent      : "",          // optional enhancement later
      outcome     : reply,
      recordingUrl: `${RecordingUrl}.mp3`,
    });

    /* 6️⃣  Twilio response (play + loop) --------------------------------------- */
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.play(audioUrl);                         // <- now a real /audio/ URL
    twiml.redirect(`/voice?client=${client}`);

    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("❌ processRecording error:", err);
    res.status(500).send("Error processing call");
  }
}
