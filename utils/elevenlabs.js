// utils/elevenlabs.js
import axios from "axios";

/** Generate speech and return a publicly reachable MP3 URL */
export async function generateSpeech(text, voiceId, stability = 0.3, similarity = 0.8) {
  const resp = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text,
      model_id: "eleven_monolingual_v1",
      voice_settings: { stability, similarity_boost: similarity },
    },
    {
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      responseType: "arraybuffer",
    }
  );

  // Twilio can stream audio if you host it.  
  // The simplest path on Railway is to base-64 inline the audio:
  const base64 = Buffer.from(resp.data, "binary").toString("base64");
  return `data:audio/mpeg;base64,${base64}`;
}
