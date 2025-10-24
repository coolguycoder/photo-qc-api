// server.js
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = 3000;

// Change this to your external server URL
const TARGET_SERVER = 'https://example.com/receive'; 

app.use(express.json());

const days = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];

// Helper function to handle approve/regenerate
function createDayEndpoints(day) {
  app.get(`/${day.toLowerCase()}/approve`, async (req, res) => {
    try {
      await axios.post(TARGET_SERVER, { day, action: 'approved' });
      res.send(`${day} has been approved`);
    } catch (error) {
      console.error(`Error sending POST for ${day} approve:`, error.message);
      res.status(500).send(`Failed to approve ${day}`);
    }
  });

  app.get(`/${day.toLowerCase()}/regenerate`, async (req, res) => {
    try {
      await axios.post(TARGET_SERVER, { day, action: 'regenerated' });
      res.send(`${day} has been regenerated`);
    } catch (error) {
      console.error(`Error sending POST for ${day} regenerate:`, error.message);
      res.status(500).send(`Failed to regenerate ${day}`);
    }
  });
}

// Generate endpoints for all days
days.forEach(createDayEndpoints);

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
