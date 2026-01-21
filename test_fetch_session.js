const axios = require('axios');

async function test() {
  try {
    const today = new Date().toISOString().split('T')[0]; // '2026-01-20'
    const url = `http://localhost:3003/accounts?classValue=10&sectionValue=A&date=${today}T10:00:00.000Z`;
    console.log("Fetching:", url);
    const res = await axios.get(url);
    
    console.log("Session Info:", res.data.session);
    console.log("Students Count:", res.data.students?.length);
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
