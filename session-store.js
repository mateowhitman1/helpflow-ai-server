// session-store.js
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const { REDIS_URL, SESSION_TTL_SECONDS } = process.env;
if (!REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set');
}

// Parse the Redis URL and initialize client
let redis;
try {
  const url = new URL(REDIS_URL.trim());
  redis = new Redis({
    host: url.hostname,
    port: Number(url.port),
    password: url.password || undefined,
  });
} catch (err) {
  throw new Error(`Invalid REDIS_URL (${err.message})`);
}

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
