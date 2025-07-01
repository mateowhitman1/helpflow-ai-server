// testProcess.js
import axios from 'axios';

(async () => {
  try {
    const resp = await axios.post(
      'http://localhost:3000/process-recording?client=helpflow',
      {
        RecordingUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        CallSid: 'SIM123',
        From: '+15551234567',
        CallStatus: 'completed'
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    console.log('/process-recording →\n', resp.data);
  } catch (err) {
    console.error('Status:', err.response?.status);
    console.error('Data:', err.response?.data);
    console.error('Message:', err.message);
    console.error(err.stack);
  }
})();
