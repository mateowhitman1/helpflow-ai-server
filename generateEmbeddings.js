// generateEmbeddings.js
// ---------------------
// Reads docChunks.json, generates embeddings via OpenAI, and writes embeddings.json
// ---------------------
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

async function main() {
  const chunksPath = path.resolve(process.cwd(), "docChunks.json");
  const raw = await fs.readFile(chunksPath, "utf-8");
  const chunks = JSON.parse(raw);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  const embeddings = [];

  for (let i = 0; i < chunks.length; i++) {
    const { text, clientId, recordId, chunkIndex } = chunks[i];
    try {
      const resp = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: text
      });
      const [data] = resp.data;
      embeddings.push({ clientId, recordId, chunkIndex, embedding: data.embedding });
      console.log(`✅ Embedded chunk ${i + 1}/${chunks.length}`);
    } catch (err) {
      console.error(`❌ Failed at chunk ${i + 1}:`, err);
    }
  }

  const outPath = path.resolve(process.cwd(), "embeddings.json");
  await fs.writeFile(outPath, JSON.stringify(embeddings, null, 2));
  console.log(`\n🎉 Wrote ${embeddings.length} embeddings to embeddings.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
