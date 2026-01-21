const axios = require('axios');

async function test() {
  try {
    console.log("Testing Login with invalid mobile...");
    // 9999999999 should not exist
    await axios.post('http://localhost:3003/login', { mobile: '9999999999' });
  } catch (err) {
    if (err.response) {
       console.log("Status:", err.response.status);
       console.log("Data:", err.response.data);
    } else {
       console.error("Error:", err.message);
    }
  }
}

test();
