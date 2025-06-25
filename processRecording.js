import axios from "axios";
import fs from "fs";
import { OpenAI } from "openai";
import FormData from "form-data";
import { ElevenLabs } from "./utils/elevenlabs.js";
import { logCallToAirtable } from "./utils/airtable.js";
import clientConfig from "./client-config.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handleRecording(req, res) {
  const { client = "helpflow" } = req.query;
  const config = clientConfig.clients[client];
  const { RecordingUrl, From, CallSid } = req.body;

  console.log(`🎙️ Received recording from ${From}: ${RecordingUrl}`);

  try {
    // Step 1: Download audio
    const audioPath = `/tmp/${CallSid}.mp3`;
    const response = await axios({
      method: "GET",
      url: `${RecordingUrl}.mp3`,
      responseType: "stream",
    });
    const writer = fs.createWriteStream(audioPath);
    response.data.pipe(writer);
    await new Promise((resolve) => writer.on("finish", resolve));

    // Step 2: Transcribe
    const transcriptResp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
    });
    const transcript = transcriptResp.text;
    console.log("📝 Transcript:", transcript);

    // Step 3: GPT-4 Turbo response
    const systemPrompt = config.scripts.systemPrompt;
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: transcript },
    ];
    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages,
    });
    const reply = gptResponse.choices[0].message.content;
    console.log("💬 GPT Reply:", reply);

    // Step 4: Convert reply to audio
    const voiceId = config.voiceId;
    const audioUrl = await ElevenLabs.generateSpeech(reply, voiceId);
    console.log("🔊 ElevenLabs URL:", audioUrl);

    // Step 5: Log to Airtable
    await logCallToAirtable({
      callId: CallSid,
      caller: From,
      transcript,
      intent: "", // You can add intent detection later
      outcome: reply,
      recordingUrl: `${RecordingUrl}.mp3`,
    });

    // Step 6: Respond with audio
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.play(audioUrl);
    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("❌ Error in processRecording:", err);
    res.status(500).send("Error processing recording");
  }
}
