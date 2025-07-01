// testSearchLocalEndpoint.js
import axios from 'axios';

async function test() {
  try {
    const resp = await axios.post(
      'http://localhost:3000/search-local',
      { query: 'What are your office hours?' },
      { headers: { 'Content-Type': 'application/json' } }
    );
    console.log('Response:', JSON.stringify(resp.data, null, 2));
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}

test();
