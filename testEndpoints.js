import axios from 'axios';

(async () => {
  try {
    // /config already tested…

    // Test /search-local
    const search = await axios.post(
      'http://localhost:3000/search-local',
      { query: 'What are your office hours?' },
      { headers: { 'Content-Type': 'application/json' } }
    );
    console.log('/search-local →', JSON.stringify(search.data, null, 2));

  } catch (err) {
    console.error('/search-local Error:', err.response?.data || err.message);
  }
})();
