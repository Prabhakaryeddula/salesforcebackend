const axios = require('axios');

async function test() {
  try {
    console.log("Sending test request...");
    const res = await axios.post('http://localhost:3003/attendance', {
      date: '2026-01-20',
      takenBy: '003fakeContactId', // Fake ID to trigger Salesforce error (if it reaches validation)
      attendances: [{
          studentId: '003fakeStudentId',
          status: 'Present',
          rollNumber: '101',
          classValue: 'Class 10',
          sectionValue: 'A'
      }]
    });
    console.log("Response:", res.data);
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
  }
}

test();
