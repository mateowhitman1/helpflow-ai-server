// listVectors.js
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const embedsPath = path.resolve(process.cwd(), process.env.EMBEDS_PATH);
if (!fs.existsSync(embedsPath)) {
  console.error(`❌ embeddings.json not found at ${embedsPath}`);
  process.exit(1);
}

const embedsRaw = fs.readFileSync(embedsPath, 'utf-8');
const embeds = JSON.parse(embedsRaw);

// assuming embeds is an array
console.log(`✅ Found ${embeds.length} embeddings in ${embedsPath}`);
