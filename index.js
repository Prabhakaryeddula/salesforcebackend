require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/**
 * Health check
 */
app.get("/", (_req, res) => {
  res.send("Backend is running");
});

/**
 * 🔐 Salesforce Login (ALWAYS fresh)
 */
async function loginToSalesforce() {
  try {
    const response = await axios.post(
      process.env.SF_LOGIN_URL, // ✅ USE ENV
      new URLSearchParams({
        grant_type: "password",
        client_id: process.env.SF_CLIENT_ID,
        client_secret: process.env.SF_CLIENT_SECRET,
        username: process.env.SF_USERNAME,
        password: process.env.SF_PASSWORD, // password + security token
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    // 🔎 IMPORTANT LOG (VERIFY ORG)
    console.log("✅ CONNECTED TO ORG:", response.data.instance_url);

    return response.data;
  } catch (err) {
    console.error(
      "❌ SALESFORCE LOGIN FAILED:",
      err.response?.data || err.message
    );
    throw err;
  }
}

/**
 * 📄 Accounts API
 */
app.get("/accounts", async (_req, res) => {
  try {
    // 🔹 Always login fresh
    const auth = await loginToSalesforce();

    const result = await axios.get(
      `${auth.instance_url}/services/data/${process.env.SF_API_VERSION}/query`,
      {
        headers: {
          Authorization: `Bearer ${auth.access_token}`,
        },
        params: {
          q: `
            SELECT Id, Name, AccountNumber, Industry
            FROM Account
            ORDER BY CreatedDate DESC
            LIMIT 5
          `,
        },
      }
    );

    res.json(result.data.records);
  } catch (err) {
    console.error(
      "❌ ACCOUNTS FETCH ERROR:",
      err.response?.data || err.message
    );
    res.status(500).json(err.response?.data || { error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
