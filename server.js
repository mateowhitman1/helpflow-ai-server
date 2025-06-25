// Log the key BEFORE any imports (to see what's available at runtime)
console.log("DEBUG - OPENAI_API_KEY (before imports):", JSON.stringify(process?.env?.OPENAI_API_KEY));

import express from "express";
import dotenv from "dotenv";
import { OpenAI } from "openai";
import twilioPkg from "twilio";
const { VoiceResponse } = twilioPkg;

// Load .env file locally — safe on Railway too
dotenv.config();

// Log the key AFTER dotenv runs
console.log("DEBUG - OPENAI_API_KEY (after dotenv):", JSON.stringify(process?.env?.OPENAI_API_KEY));

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Twilio client (optional use later)
const client = twilioPkg(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ✅ Check for OpenAI key
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY is missing — check Railway Variables.");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🌐 Root route
app.get("/", (req, res) => {
  res.send("🚀 HelpFlow AI Server is Running!");
});

// 🤖 Test OpenAI route
app.get("/test-gpt", async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Say hello!" }],
    });

    res.send(completion.choices[0].message.content);
  } catch (err) {
    console.error("OpenAI Error:", err);
    res.status(500).send("There was an error calling OpenAI.");
  }
});

// 📞 Twilio voice webhook route with debug logging
app.post("/voice", (req, res) => {
  console.log("🔔 /voice route triggered");

  try {
    console.log("➡ Creating VoiceResponse instance...");
    const twiml = new VoiceResponse();

    console.log("➡ Adding say()...");
    twiml.say({ voice: "alice" }, "Hello! Thanks for calling HelpFlow AI. We'll be in touch shortly.");

    const responseXml = twiml.toString();
    console.log("✅ TwiML generated:", responseXml);

    res.type("text/xml");
    res.send(responseXml);
  } catch (error) {
    console.error("❌ Error inside /voice route:", error);
    res.status(500).send("Error generating voice response");
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});



