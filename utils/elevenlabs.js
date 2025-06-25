import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
console.log(
  "ElevenLabs key in memory →",
  process.env.ELEVENLABS_API_KEY?.slice(0, 8) + "…"
);

/**
 * Generate speech with ElevenLabs, store in public/audio/, return a URL Twilio can play.
 * @param {string}  text    – text to speak
 * @param {string}  voiceId – ElevenLabs voice ID
 * @param {string}  callId  – Twilio Call SID (used as filename)
 * @returns {string}        – `/audio/<callId>.mp3`
 */
export async function generateSpeech(text, voiceId, callId) {
  if (!process.env.ELEVENLABS_API_KEY)
    throw new Error("Missing ELEVENLABS_API_KEY env var");

  /* ---- 1. call “/stream” endpoint & request raw audio -------------------- */
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;
  const response = await axios({
    method: "POST",
    url,
    responseType: "stream",                   // << audio stream!
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    data: {
      text,
      model_id: "eleven_turbo_v2",            // cheaper / faster
      voice_settings: { stability: 0.5, similarity_boost: 0.5 },
    },
  });

  /* ---- 2. save to  public/audio/<CallSid>.mp3  --------------------------- */
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir    = path.join(__dirname, "..", "public", "audio");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `${callId}.mp3`);
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(outFile);
    response.data.pipe(w);
    w.on("finish", resolve);
    w.on("error",  reject);
  });

  /* ---- 3. return URL that server.js exposes via express.static ----------- */
  return `/audio/${callId}.mp3`;
}
