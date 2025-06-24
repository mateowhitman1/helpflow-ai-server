// server.js
import express from "express";
import dotenv from "dotenv";
import { OpenAI } from "openai";
import twilio from "twilio";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ NEW: Home route
app.get("/", (req, res) => {
  res.send("🚀 HelpFlow AI Server is Running!");
});

// Existing test route for OpenAI
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
