// config.js
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Ensure VECTOR_STORE_PATH is set in .env
if (!process.env.VECTOR_STORE_PATH) {
  throw new Error('VECTOR_STORE_PATH is not set in .env');
}

// Resolve the base folder where your store files live
export const VECTOR_STORE_PATH = path.resolve(
  process.cwd(),
  process.env.VECTOR_STORE_PATH
);

// Build full paths to your JSON files
export const CHUNKS_PATH = path.resolve(
  process.cwd(),
  process.env.CHUNKS_PATH
);
export const EMBEDS_PATH = path.resolve(
  process.cwd(),
  process.env.EMBEDS_PATH
);
