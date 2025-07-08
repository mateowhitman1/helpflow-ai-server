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
 * @param {string}  text       – text to speak
 * @param {string}  voiceId    – ElevenLabs voice ID
 * @param {string}  callId     – Twilio Call SID (used as filename)
 * @param {object}  opts       – optional voice parameters: { modelId, stability, similarity, voiceSpeed }
 * @returns {string}           – `/audio/<callId>.mp3`
 */
export async function generateSpeech(text, voiceId, callId, opts = {}) {
  if (!process.env.ELEVENLABS_API_KEY)
    throw new Error("Missing ELEVENLABS_API_KEY env var");

  const {
    modelId = "eleven_turbo_v2", 
    stability = 0.5, 
    similarity = 0.75, 
    voiceSpeed = 1.0
  } = opts;

  /* ---- 1. call “/stream” endpoint & request raw audio -------------------- */
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;
  const response = await axios({
    method: "POST",
    url,
    responseType: "stream",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    data: {
      text,
      model_id: modelId,
      voice_settings: {
        stability,
        similarity_boost: similarity
      },
      format: "mp3",
      sample_rate: 16000
    },
  });

  /* ---- 2. save to public/audio/<callId>.mp3 --------------------------- */
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(__dirname, "..", "public", "audio");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `${callId}.mp3`);
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outFile);
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  console.log(`Wrote TTS file to ${outFile}`);

  /* ---- 3. return URL ----------------------------------------------- */
  return `/audio/${callId}.mp3`;
}
