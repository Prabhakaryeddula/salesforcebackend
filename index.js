require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/**
 * Simple health check
 */
app.get("/", (_req, res) => {
  res.send("Salesforce Attendance Backend is running ✓");
});

/**
 * Get fresh Salesforce access token
 */
async function loginToSalesforce() {
  try {
    const response = await axios.post(
      process.env.SF_LOGIN_URL,
      new URLSearchParams({
        grant_type: "password",
        client_id: process.env.SF_CLIENT_ID,
        client_secret: process.env.SF_CLIENT_SECRET,
        username: process.env.SF_USERNAME,
        password:
          process.env.SF_PASSWORD + (process.env.SF_SECURITY_TOKEN || ""),
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    console.log("[SF LOGIN] Connected to:", response.data.instance_url);
    return response.data;
  } catch (err) {
    console.error("[SF LOGIN] Failed:", err?.response?.data || err.message);
    throw err;
  }
}

/**
 * Basic SOQL string escape
 */
function escapeSOQL(str) {
  if (!str) return "";
  return String(str).replace(/'/g, "\\'").replace(/%/g, "\\%");
}

/**
 * GET /accounts
 * Returns students (Accounts) filtered by Class__c and optional Section__c
 */
/*app.get("/accounts", async (req, res) => {
  const { class: classParam, section: sectionParam } = req.query;

  console.log("[REQ] Query params:", req.query);

  const classValue = classParam ? String(classParam).trim() : null;
  const sectionValue = sectionParam ? String(sectionParam).trim() : null;

  if (!classValue) {
    return res.status(400).json({
      error: "Missing required parameter",
      message: "class parameter is required (e.g. ?class=10)",
    });
  }

  try {
    const auth = await loginToSalesforce();

    // Always quote Class__c – most custom fields are Text even if they contain numbers
    let soql = `
      SELECT Id, Name, AccountNumber, Class__c, Section__c
      FROM Account
      WHERE Class__c = '${escapeSOQL(classValue)}'
    `;

    if (sectionValue) {
      soql += ` AND Section__c = '${escapeSOQL(sectionValue)}'`;
    }

    soql += `
      ORDER BY Name ASC
      LIMIT 300
    `;

    console.log("[SOQL]", soql);

    const response = await axios.get(
      `${auth.instance_url}/services/data/${
        process.env.SF_API_VERSION || "v61.0"
      }/query`,
      {
        headers: {
          Authorization: `Bearer ${auth.access_token}`,
        },
        params: {
          q: soql,
        },
      }
    );

    const records = response.data.records || [];

    console.log(`[RESULT] Found ${records.length} students`);

    res.json(records);
  } catch (error) {
    console.error("[SF ERROR]", error?.response?.data || error.message);

    const status = error?.response?.status || 500;
    const sfError = error?.response?.data?.[0] || {}; // Salesforce usually returns array

    res.status(status).json({
      error: "Failed to fetch students from Salesforce",
      message: sfError.message || error.message,
      errorCode: sfError.errorCode || null,
      details: error?.response?.data || null,
    });
  }
});*/

app.get("/accounts", async (req, res) => {
  console.log("[REQ] Query:", req.query);

  const classValue = req.query.classValue
    ? String(req.query.classValue).trim()
    : null;

  const sectionValue = req.query.section
    ? String(req.query.section).trim()
    : null;

  // 🚨 HARD VALIDATION
  if (!classValue) {
    return res.status(400).json({
      error: "Missing required parameter",
      message: "classValue is required (e.g. ?classValue=10)",
    });
  }

  try {
    const auth = await loginToSalesforce();

    let soql = `
      SELECT Id, Name, AccountNumber, Class__c, Section__c
      FROM Account
      WHERE Class__c = '${escapeSOQL(classValue)}'
    `;

    if (sectionValue) {
      soql += ` AND Section__c = '${escapeSOQL(sectionValue)}'`;
    }

    soql += ` ORDER BY Name ASC LIMIT 300`;

    console.log("[SOQL]", soql);

    const response = await axios.get(
      `${auth.instance_url}/services/data/${
        process.env.SF_API_VERSION || "v61.0"
      }/query`,
      {
        headers: {
          Authorization: `Bearer ${auth.access_token}`,
        },
        params: { q: soql },
      }
    );

    const records = response.data.records || [];
    console.log(`[RESULT] Found ${records.length} students`);

    res.json(records);
  } catch (error) {
    console.error("[SF ERROR]", error?.response?.data || error.message);

    const sfError = error?.response?.data?.[0] || {};

    res.status(500).json({
      error: "Salesforce query failed",
      message: sfError.message || error.message,
      errorCode: sfError.errorCode || null,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Endpoint: GET /accounts   ?class=10   &section=A");
});
