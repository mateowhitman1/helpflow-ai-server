// server.js
// -----------------------------------------------------------------------------
// Main entry for the HelpFlow AI voice‑bot server (in‑memory retrieval)
// -----------------------------------------------------------------------------
// Requires Node v18+ for ES modules and "type":"module" in package.json

import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import twilio from "twilio";
import cosine from "cosine-similarity";
import OpenAI from "openai";
import clientConfig from "./client-config.js";
import { handleRecording } from "./processRecording.js";

// Derive __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Ensure public/audio exists
const audioDir = path.join(__dirname, "public", "audio");
fs.mkdirSync(audioDir, { recursive: true });

// Load embeddings and document chunks
const embeddings = JSON.parse(
  fs.readFileSync(path.join(__dirname, "embeddings.json"), "utf8")
);
const docChunks = JSON.parse(
  fs.readFileSync(path.join(__dirname, "docChunks.json"), "utf8")
);

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory retrieval helper
async function retrieveContext(question, topK = 5) {
  // 1) Embed the question
  const res = await openai.embeddings.create({
    input: question,
    model: "text-embedding-ada-002"
  });
  const qVec = res.data[0].embedding;

  // 2) Compute similarity scores
  const scored = embeddings.map(e => ({ id: e.id, score: cosine(qVec, e.values) }));

  // 3) Select top K chunks
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ id }) => {
      const chunk = docChunks.find(c => c.id === id);
      return { id, text: chunk?.text || "" };
    });
}

// Express app setup
const app = express();
const PORT = process.env.PORT || 8080;
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/audio", express.static(audioDir));

// Health-check
app.get("/", (_, res) => res.send("👍 OK – HelpFlow AI server is live"));

// Retrieval endpoint
app.post("/retrieve", async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: "question is required" });
  try {
    const context = await retrieveContext(question);
    res.json({ context });
  } catch (err) {
    console.error("❌ /retrieve error:", err);
    res.status(500).json({ error: "Retrieval failed" });
  }
});

// Twilio voice webhook
app.post("/voice", (req, res) => {
  try {
    const { client: clientId = "helpflow" } = req.query;
    const cfg = clientConfig.clients?.[clientId];
    if (!cfg) return res.status(400).send("Unknown client");

    const vr = new twilio.twiml.VoiceResponse();
    vr.say({ voice: "alice" }, cfg.scripts.greeting);
    vr.record({
      action: `/process-recording?client=${clientId}`,
      method: "POST",
      maxLength: 30,
      playBeep: true,
      trim: "silence"
    });
    res.type("text/xml").send(vr.toString());
  } catch (err) {
    console.error("❌ /voice error:", err);
    res.status(500).send("Voice webhook failure");
  }
});

// Delegate to recording handler
app.post("/process-recording", handleRecording);

// Bootstrap: start server
app.listen(PORT, () => console.log(`✅ Server listening on port ${PORT}`));
