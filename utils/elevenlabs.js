// utils/elevenlabs.js
import axios from "axios";
export async function generateSpeech(text, voiceId) {
  const resp = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text,
      model_id: "eleven_monolingual_v1",
      voice_settings: { stability: 0.3, similarity_boost: 0.8 },
    },
    {
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      responseType: "arraybuffer",
    }
  );
  const b64 = Buffer.from(resp.data, "binary").toString("base64");
  return `data:audio/mpeg;base64,${b64}`;
}
