import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import { search } from "./vectorStore.js";

(async () => {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resp = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: "What are your business hours?"
  });
  const queryEmbed = resp.data[0].embedding;
  const results = await search(queryEmbed, 3);
  console.log("Top 3 chunks:", results);
})();
