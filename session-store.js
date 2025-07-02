// session-store.js
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const { REDIS_URL, SESSION_TTL_SECONDS } = process.env;
if (!REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set');
}

// Trim whitespace
const redisUrl = REDIS_URL.trim();

// Determine options: Upstash requires TLS
const options = {};
if (redisUrl.includes('upstash.io')) {
  options.tls = {};
}

// Initialize Redis client using connection string + options
const redis = new Redis(redisUrl, options);

const TTL = SESSION_TTL_SECONDS ? Number(SESSION_TTL_SECONDS) : 3600;

/**
 * Retrieve a session by CallSid
 * @param {string} callSid
 * @returns {Promise<{history: Array<{user: string, assistant: string}>}>}
 */
export async function getSession(callSid) {
  const data = await redis.get(`session:${callSid}`);
  return data ? JSON.parse(data) : { history: [] };
}

/**
 * Save a session (with TTL)
 * @param {string} callSid
 * @param {object} session
 */
export async function saveSession(callSid, session) {
  await redis.set(`session:${callSid}`, JSON.stringify(session), 'EX', TTL);
}

/**
 * Clear a session when call ends
 * @param {string} callSid
 */
export async function clearSession(callSid) {
  await redis.del(`session:${callSid}`);
}
