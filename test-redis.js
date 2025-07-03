import { getSession, saveSession, clearSession } from './session-store.js';

async function smokeTest() {
  const sid = 'SMOKETEST123';
  console.log('Initial session:', await getSession(sid));
  await saveSession(sid, { history: [{ user: 'hello', assistant: 'hi there' }] });
  console.log('After save:', await getSession(sid));
  await clearSession(sid);
  console.log('After clear:', await getSession(sid));
  process.exit(0);
}

smokeTest().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
