// testConfig.js
import axios from 'axios';

(async () => {
  try {
    const resp = await axios.get('http://localhost:3000/config?client=helpflow');
    console.log('/config →', resp.data);
  } catch (e) {
    console.error('/config Error:', e.response?.data || e.message);
  }
})();
