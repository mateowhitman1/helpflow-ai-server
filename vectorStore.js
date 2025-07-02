// vectorStore.js
import fs from 'fs/promises';
import cosineSimilarity from 'cosine-similarity';
import path from 'path';
import { CHUNKS_PATH, EMBEDS_PATH } from './config.js';

/**
 * Factory to create a vector store scoped to a client.
 * @param {string} clientId
 */
export function makeVectorStore(clientId) {
  // Paths for this client's index files
  const chunksFile = path.join(process.cwd(), 'db', `${clientId}_chunks.json`);
  const embedsFile = path.join(process.cwd(), 'db', `${clientId}_embeds.json`);

  // Load index files
  async function loadIndex() {
    try {
      const [chunksRaw, embedsRaw] = await Promise.all([
        fs.readFile(chunksFile, 'utf-8'),
        fs.readFile(embedsFile, 'utf-8'),
      ]);
      return {
        chunks: JSON.parse(chunksRaw),
        embeds: JSON.parse(embedsRaw),
      };
    } catch (err) {
      // If files don't exist, initialize empty index
      if (err.code === 'ENOENT') {
        return { chunks: [], embeds: [] };
      }
      throw err;
    }
  }

  // Write back index files
  async function writeIndex(chunks, embeds) {
    await Promise.all([
      fs.mkdir(path.dirname(chunksFile), { recursive: true }),
      fs.mkdir(path.dirname(embedsFile), { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(chunksFile, JSON.stringify(chunks, null, 2)),
      fs.writeFile(embedsFile, JSON.stringify(embeds, null, 2)),
    ]);
  }

  /**
   * Search top-k nearest neighbors for a query embedding.
   * @param {number[]} queryEmbed
   * @param {number} k
   */
  async function search(queryEmbed, k = 5) {
    const { chunks, embeds } = await loadIndex();
    const sims = embeds.map((item, i) => ({
      index: i,
      score: cosineSimilarity(queryEmbed, item.embedding),
    }));
    sims.sort((a, b) => b.score - a.score);
    return sims.slice(0, k).map(({ index, score }) => ({
      score,
      chunk: chunks[index],
    }));
  }

  /**
   * Upsert a single embedding + metadata chunk.
   * @param {{ embedding: number[], metadata: { source: string, text: string } }} param0
   */
  async function upsertChunk({ embedding, metadata }) {
    const { chunks, embeds } = await loadIndex();
    const id = `${metadata.source}-${Date.now()}`;
    chunks.push(metadata);
    embeds.push({ embedding, id });
    await writeIndex(chunks, embeds);
  }

  return { search, upsertChunk };
}
