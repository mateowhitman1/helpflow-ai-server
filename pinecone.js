import { PineconeClient } from "@pinecone-database/pinecone";
import dotenv from "dotenv";
dotenv.config();

export const pinecone = new PineconeClient();

export async function initPinecone() {
  await pinecone.init({
    apiKey: process.env.PINECONE_API_KEY,
    environment: process.env.PINECONE_ENVIRONMENT
  });

  const INDEX_NAME = "helpflow-ai-docs";
  const existing = await pinecone.listIndexes();
  if (!existing.includes(INDEX_NAME)) {
    // adjust dimension to match your embeddings.json vectors length
    const dimension = 1536;  
    await pinecone.createIndex({
      name: INDEX_NAME,
      dimension,
      metric: "cosine"
    });
    console.log(`✅ Created Pinecone index: ${INDEX_NAME}`);
  }

  return pinecone.Index(INDEX_NAME);
}
