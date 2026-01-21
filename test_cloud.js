const axios = require('axios');

const BASE_URL = "https://salesforcebackend.onrender.com";

async function testConnection() {
    console.log(`Testing connection to: ${BASE_URL}`);

    // 1. Health Check
    try {
        const res = await axios.get(BASE_URL + "/");
        console.log(`[HEALTH CHECK] Status: ${res.status}, Data: ${res.data}`);
    } catch (err) {
        console.error(`[HEALTH CHECK FAILED]`, err.message);
    }

    // 2. Test Login (expecting 400 or 404, not 500/502)
    try {
        console.log(`[LOGIN TEST] Sending empty request...`);
        await axios.post(BASE_URL + "/login", {});
    } catch (err) {
        if (err.response) {
            console.log(`[LOGIN RESPONSE] Status: ${err.response.status} (Expected 400 for missing mobile)`);
            console.log(`[LOGIN DATA]`, err.response.data);
        } else {
            console.error(`[LOGIN NETWORK ERROR]`, err.message);
        }
    }
}

testConnection();
