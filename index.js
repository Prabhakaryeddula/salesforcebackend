require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3003;

let cachedAuth = null;
let authExpiry = 0;

/**
 * Cache for resolved Account field API names to avoid repeated describe calls.
 * { classField: string, sectionField: string, ts: number }
 */
let fieldNameCache = {
  classField: "Current_Class__c",
  sectionField: "Section__c",
  ts: 0,
};

async function getSalesforceToken() {
  if (cachedAuth && Date.now() < authExpiry) {
    return cachedAuth;
  }

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
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    cachedAuth = response.data;
    authExpiry = Date.now() + (response.data.expires_in * 1000 - 300000); // refresh 5 min early

    console.log("[SF] Authenticated →", cachedAuth.instance_url);
    return cachedAuth;
  } catch (err) {
    console.error("[SF AUTH ERROR]", err?.response?.data || err.message);
    throw err;
  }
}

function escapeSOQL(value) {
  // treat only null/undefined as empty; allow "0" and other falsy strings
  if (value == null) return "";
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%");
}

/**
 * Resolve the actual API field names on Account for class/section.
 * Uses describe to match by label or name heuristics. Caches results for 5m.
 */
async function resolveAccountFieldNames(auth) {
  const CACHE_TTL = 5 * 60 * 1000;
  if (fieldNameCache.ts && Date.now() - fieldNameCache.ts < CACHE_TTL) {
    return fieldNameCache;
  }

  try {
    const url = `${auth.instance_url}/services/data/v61.0/sobjects/Account/describe`;
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${auth.access_token}` },
    });


    const fields = Array.isArray(resp.data?.fields) ? resp.data.fields : [];

    const findFieldName = (candidates) => {
      candidates = candidates.map((c) => c.toLowerCase());
      // exact label match first
      let f = fields.find(
        (fld) =>
          fld.label && candidates.includes(String(fld.label).toLowerCase())
      );
      if (f) return f.name;
      // name includes candidate
      f = fields.find(
        (fld) =>
          fld.name &&
          candidates.some((c) => String(fld.name).toLowerCase().includes(c))
      );
      if (f) return f.name;
      // fallback to any custom field that contains candidate as token
      f = fields.find(
        (fld) =>
          fld.name &&
          fld.name.toLowerCase().endsWith("__c") &&
          candidates.some((c) => fld.name.toLowerCase().includes(c))
      );
      return f ? f.name : null;
    };

    const classField =
      findFieldName(["class", "Current_Class__c", "Current_Class__c"]) ||
      "Current_Class__c";
    const sectionField =
      findFieldName(["section", "Section__c", "Section__c"]) || "Section__c";

    fieldNameCache = { classField, sectionField, ts: Date.now() };
    console.log("[DESCRIBE] resolved fields:", fieldNameCache);
    return fieldNameCache;
  } catch (err) {
    console.error("[DESCRIBE ERROR]", err?.response?.data || err.message);
    // fallback to defaults so other logic can continue
    fieldNameCache = { ...fieldNameCache, ts: Date.now() };
    return fieldNameCache;
  }
}

// Health check
app.get("/", (req, res) => {
  res.send("Attendance Backend ✓");
});

// Get students
app.get("/accounts", async (req, res) => {
  const queryParams = req.query || {};
  // support multiple possible keys to be robust
  const rawCls =
    queryParams.classValue ??
    queryParams.class ??
    queryParams.cls ??
    queryParams.className ??
    null;
  const rawSection =
    queryParams.sectionValue ??
    queryParams.section ??
    queryParams.sec ??
    queryParams.Section__c ??
    null;

  console.log("[GET /accounts] params:", queryParams);

  const classValue = rawCls != null ? String(rawCls).trim() : ""; // handle numbers too
  const sectionValue = rawSection != null ? String(rawSection).trim() : "";

  if (!classValue) {
    return res.status(400).json({
      error: "Missing 'class' parameter",
      message: "Provide ?classValue=10",
    });
  }



  let soql = "";
  try {
    const auth = await getSalesforceToken();

    // Resolve actual API field names on Account
    const { classField, sectionField } = await resolveAccountFieldNames(auth);
    console.log(classField, "${escapeSOQL(classValue)}");
    console.log("Check herreeeeee");
    // Build SOQL using resolved field names
    soql = `SELECT Id, Name, Roll_No__c, ${classField}, ${sectionField}
                FROM Account
                WHERE (${classField} = '${escapeSOQL(classValue)}' OR ${classField} = 'Class ${escapeSOQL(classValue)}')`;

    if (sectionValue) {
      soql += ` AND ${sectionField} = '${escapeSOQL(sectionValue)}'`;
    }

    soql += " ORDER BY Name ASC LIMIT 300";

    console.log("[SOQL]", soql);

    const url = `${auth.instance_url}/services/data/v61.0/query`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${auth.access_token}` },
      params: { q: soql },
    });

    let records =
      response.data && Array.isArray(response.data.records)
        ? response.data.records
        : [];

    // If date is provided, fetch existing attendance status
    const dateParam = queryParams.date;
    if (dateParam && records.length > 0) {
       const studentIds = records.map(r => `'${r.Id}'`).join(",");
       const dateLiteral = String(dateParam).split("T")[0];
       const attQuery = `SELECT Student__c, Attendance_Status__c FROM Attendance__c WHERE Attendance_Date__c = ${dateLiteral} AND Student__c IN (${studentIds})`;
       
       console.log("[GET /accounts] Fetching attendance:", attQuery);
       
       const attUrl = `${auth.instance_url}/services/data/v61.0/query?q=` + encodeURIComponent(attQuery);
       const attRes = await axios.get(attUrl, { headers: { Authorization: `Bearer ${auth.access_token}` } });
       const attRecords = attRes.data.records || [];
       
       const statusMap = new Map();
       attRecords.forEach(a => statusMap.set(a.Student__c, a.Attendance_Status__c));
       
       records = records.map(r => ({
         ...r,
         Attendance_Status__c: statusMap.get(r.Id) || null
       }));
    }

    // 3. Fetch Session Info (Restored)
    let sessionInfo = null;
    if (classValue && sectionValue && dateParam) {
       try {
           const dateLiteral = String(dateParam).split("T")[0];
           
           // Normalize Class Name (Strip "Class " to match creation logic)
           const sessionClassVal = classValue.replace(/^Class\s+/i, "");

           // Query for Session and the Taken By Name (Lookup)
           const sessQuery = `SELECT Id, Taken_By__r.Name FROM Attendance_Session__c WHERE Class__c = '${escapeSOQL(sessionClassVal)}' AND Section__c = '${escapeSOQL(sectionValue)}' AND Date__c = '${dateLiteral}' LIMIT 1`;
           console.log(`[SESSION FETCH QUERY] ${sessQuery}`);
           const sessUrl = `${auth.instance_url}/services/data/v61.0/query?q=` + encodeURIComponent(sessQuery);
           const sessRes = await axios.get(sessUrl, { headers: { Authorization: `Bearer ${auth.access_token}` } });
           
           if (sessRes.data.records && sessRes.data.records.length > 0) {
               const rec = sessRes.data.records[0];
               sessionInfo = {
                   id: rec.Id,
                   takenBy: rec.Taken_By__r ? rec.Taken_By__r.Name : "Unknown"
               };
           }
       } catch (err) {
           console.error("[SESSION FETCH ERROR]", err.message);
       }
    }

    console.log(`[OK] Found ${records.length} students, Session: ${sessionInfo ? "YES" : "NO"}`);
    // Return structured response
    res.json({ students: records, session: sessionInfo });
  } catch (err) {
    console.error("[SF ERROR]", err.message);
    if (err.response) {
      console.error("[SF RESPONSE DATA]", JSON.stringify(err.response.data, null, 2));
    }

    const status = err.response?.status || 500;
    // extract a helpful message from possible SF error shapes
    let msg = err.message;
    if (err.response && err.response.data) {
      if (Array.isArray(err.response.data) && err.response.data[0]?.message) {
        msg = err.response.data[0].message;
      } else if (err.response.data.message) {
        msg = err.response.data.message;
      } else {
        try {
          msg = JSON.stringify(err.response.data);
        } catch (_) {}
      }
    }

    res.status(status).json({ 
      error: "Salesforce query failed", 
      message: msg,
      details: err.response?.data,
      soqlQuery: soql 
    });
  }
});



// Save attendance (assumes Attendance__c object with Student__c lookup, Date__c, Status__c picklist)
app.post("/attendance", async (req, res) => {
  const { date, attendances, takenBy } = req.body;
  console.log("[POST /attendance] body:", { date, count: attendances.length, takenBy });

  if (!date || !Array.isArray(attendances) || attendances.length === 0) {
    return res.status(400).json({ error: "Missing date or attendances array" });
  }

  try {
    const auth = await getSalesforceToken();
    const dateLiteral = String(date).split("T")[0];

    // --- STEP 0: UPSERT ATTENDANCE SESSION ---
    // We need Class and Section to identify the session.
    // Assuming all students in the payload belong to the same Class/Section (which is true for the current UI).
    const firstItem = attendances[0];
    const classVal = firstItem.classValue.replace(/^Class\s+/i, "");
    const sectionVal = firstItem.sectionValue;

    console.log(`[DEBUG SESSION] classVal: '${classVal}', sectionVal: '${sectionVal}', takenBy: '${takenBy}'`);

     if (classVal && sectionVal && takenBy) {
        console.log(`[SESSION START] takenBy: ${takenBy} (Type: ${typeof takenBy})`);
        let sessionQuery = "";
        try {
          // Quote Date__c as per previous error fix
          sessionQuery = `SELECT Id FROM Attendance_Session__c WHERE Class__c = '${escapeSOQL(classVal)}' AND Section__c = '${escapeSOQL(sectionVal)}' AND Date__c = '${dateLiteral}' LIMIT 1`;
          console.log(`[SESSION QUERY] ${sessionQuery}`);
         
         const sessUrl = `${auth.instance_url}/services/data/v61.0/query?q=` + encodeURIComponent(sessionQuery);
         const sessRes = await axios.get(sessUrl, { headers: { Authorization: `Bearer ${auth.access_token}` } });
         
         if (sessRes.data.records && sessRes.data.records.length > 0) {
            // Update existing session
            const sessId = sessRes.data.records[0].Id;
            await axios.patch(
              `${auth.instance_url}/services/data/v61.0/sobjects/Attendance_Session__c/${sessId}`,
              { Taken_By__c: takenBy },
              { headers: { Authorization: `Bearer ${auth.access_token}` } }
            );
            console.log(`[SESSION] Updated session ${sessId} by ${takenBy}`);
         } else {
            // Create new session
            await axios.post(
              `${auth.instance_url}/services/data/v61.0/sobjects/Attendance_Session__c`,
              {
                Class__c: classVal,
                Section__c: sectionVal,
                Date__c: dateLiteral,
                Taken_By__c: takenBy
              },
              { headers: { Authorization: `Bearer ${auth.access_token}` } }
            );
            console.log(`[SESSION] Created new session by ${takenBy}`);
         }
       } catch (err) {
         console.error("[SESSION ERROR]", err.response?.data || err.message);
         console.error("Failed Query:", sessionQuery);
       }
    }

    // 1. Check for existing attendance records for these students on this date
    const studentIds = attendances.map(a => `'${escapeSOQL(a.studentId)}'`).join(","); 
    
    // SOQL query to find existing records
    const query = `SELECT Id, Student__c FROM Attendance__c WHERE Attendance_Date__c = ${dateLiteral} AND Student__c IN (${studentIds})`;
    const queryUrl = `${auth.instance_url}/services/data/v61.0/query?q=` + encodeURIComponent(query);
    
    console.log("[UPSERT CHECK]", query);

    const checkRes = await axios.get(queryUrl, { headers: { Authorization: `Bearer ${auth.access_token}` } });
    const existingRecords = checkRes.data.records || [];
    const existingMap = new Map(); // StudentId -> AttendanceId
    existingRecords.forEach(r => existingMap.set(r.Student__c, r.Id));
    


    // 2. Build Composite Request (PATCH if exists, POST if new)
    // FILTER: Only create records for "Absent". 
    // BUT: Always update existing records (even if Present) to correct mistakes.
    const recordsToProcess = attendances.filter(item => {
       const existingId = existingMap.get(item.studentId);
       const isAbsent = item.status === "Absent";
       // Keep if it already exists (must update) OR if it is Absent (must create)
       return existingId || isAbsent;
    });

    if (recordsToProcess.length === 0) {
      return res.json({ success: true, message: "No absences to record.", saved: 0 });
    }

    const composite = {
      allOrNone: true,
      compositeRequest: recordsToProcess.map((item, index) => {
        const existingId = existingMap.get(item.studentId);
        const method = existingId ? "PATCH" : "POST";
        const url = existingId 
          ? `/services/data/v61.0/sobjects/Attendance__c/${existingId}`
          : `/services/data/v61.0/sobjects/Attendance__c`;
          
        return {
          method,
          url,
          referenceId: `ref${index}`,
          body: {
            Student__c: item.studentId,
            Attendance_Date__c: date,
            Attendance_Status__c: item.status,
            Roll_Number__c: item.rollNumber,
            Class__c: item.classValue.replace(/^Class\s+/i, ""),
            Section__c: item.sectionValue,
          },
        };
      }),
    };

    const response = await axios.post(
      `${auth.instance_url}/services/data/v61.0/composite`,
      composite,
      { headers: { Authorization: `Bearer ${auth.access_token}` } }
    );

    const compositeResponse =
      response.data && response.data.compositeResponse
        ? response.data.compositeResponse
        : [];

    const hasErrors = compositeResponse.some((r) => r.httpStatusCode >= 400);
    if (hasErrors) {
      console.error("[COMPOSITE ERRORS]", JSON.stringify(compositeResponse, null, 2));
      return res
        .status(500)
        .json({ error: "Some records failed", details: compositeResponse });
    }

    console.log("[OK] Saved", attendances.length, "attendance records");
    res.json({ success: true, saved: attendances.length });
  } catch (err) {
    console.error(
      "[ATTENDANCE SAVE ERROR]",
      err?.response?.data || err.message
    );
    const msg = err.response?.data?.message || err.message;
    res.status(500).json({ error: "Failed to save attendance", message: msg });
  }
});

// Login Endpoint
app.post("/login", async (req, res) => {
  const { mobile } = req.body;
  if (!mobile) return res.status(400).json({ error: "Mobile number required" });

  try {
    const auth = await getSalesforceToken();
    const safeMobile = escapeSOQL(mobile);
    
    // Check Contact for this mobile number
    // Creating SOQL to match MobilePhone field
    const q = `SELECT Id, Name, Type__c FROM Contact WHERE MobilePhone = '${safeMobile}' LIMIT 1`;
    const url = `${auth.instance_url}/services/data/v61.0/query?q=${encodeURIComponent(q)}`;
    
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${auth.access_token}`}});
    const records = resp.data.records || [];
    
    if (records.length === 0) {
      return res.status(404).json({ error: "Sorry you entered incorrect username" });
    }
    
    const user = records[0];
    const role = user.Type__c;
    
    console.log(`[LOGIN SUCCESS] User: ${user.Name}, ID: ${user.Id}, Role: ${role}`);

    if (role === "Teacher" || role === "Principal") {
      // Return ID (Contact ID) for Lookup usage
      return res.json({ 
        success: true, 
        user: { 
          id: user.Id, 
          name: user.Name, 
          role 
        } 
      });
    } else {
      return res.status(403).json({ error: "Access Denied: Only Teachers or Principals can log in." });
    }

  } catch (err) {
    console.error("[LOGIN ERROR]", err.message);
    const detail = err.response?.data || err.message;
    res.status(500).json({ error: "Login failed", details: detail });
  }
});

app.listen(PORT, async () => {
  console.log(`Server running → https://salesforcebackend.onrender.com`);
  console.log("POST /login");
  console.log("GET  /accounts?classValue=10&sectionValue=A");
  console.log("POST /attendance");
});
