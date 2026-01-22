const axios = require('axios');

const BASE_URL = "https://salesforcebackend.onrender.com";
const MOBILE = "9392723536"; // From user screenshot

async function testLogin() {
    console.log(`Testing Login to: ${BASE_URL} with mobile ${MOBILE}`);

    try {
        const res = await axios.post(BASE_URL + "/login", { mobile: MOBILE });
        console.log(`[SUCCESS] Status: ${res.status}`);
        console.log(`[USER]`, res.data);
    } catch (err) {
        if (err.response) {
            console.log(`[FAILED] Status: ${err.response.status}`);
            console.log(`[DATA]`, err.response.data);
        } else {
            console.error(`[NETWORK ERROR]`, err.message);
        }
    }
}

testLogin();
