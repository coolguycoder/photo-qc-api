// server.js
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Primary webhook / target server for approve/regenerate-single (can be set via env)
const TARGET_SERVER = process.env.TARGET_SERVER || 'http://192.168.1.249:5678/webhook/approveorregen';

// Primary webhook / target server specifically for regenerate-all
const REGENERATE_TARGET = process.env.REGENERATE_TARGET || process.env.TARGET_SERVER || 'http://192.168.1.249:5678/webhook-test/regen-all';

// Optional additional webhook to forward regenerate-all requests to
const ADDITIONAL_REGENERATE_WEBHOOK = process.env.ADDITIONAL_REGENERATE_WEBHOOK || null;

// Configurable webhook behavior
const WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS) || 10000; // ms
const WEBHOOK_RETRIES = Number(process.env.WEBHOOK_RETRIES) || 0; // number of retries on failure
const FIRE_AND_FORGET = process.env.FIRE_AND_FORGET === 'true'; // if true, respond immediately and forward webhooks async

// Helper to post with optional retries
async function postWithRetries(url, payload, timeout = WEBHOOK_TIMEOUT_MS, retries = WEBHOOK_RETRIES) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.post(url, payload, { timeout });
    } catch (err) {
      lastErr = err;
      const backoff = 200 * (attempt + 1);
      console.warn(`POST to ${url} failed (attempt ${attempt + 1}/${retries + 1}):`, err.message || err.toString());
      if (attempt < retries) await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

// Fire-and-forget: forward but don't await; errors are logged
function fireAndForgetPost(url, payload, timeout = WEBHOOK_TIMEOUT_MS, retries = WEBHOOK_RETRIES) {
  postWithRetries(url, payload, timeout, retries)
    .then((resp) => console.log(`Async POST to ${url} succeeded:`, resp.status))
    .catch((err) => console.error(`Async POST to ${url} failed:`, err.message || err.toString()));
}

app.use(express.json());

// Routes
// View/Load Image: /api/photos/:day
app.get('/api/photos/:day', (req, res) => {
  const { day } = req.params;
  // Placeholder: return a simple message. Replace with real image loading logic as needed.
  res.json({ day, message: `Loaded image for ${day}` });
});

// Batch Regenerate: /api/actions/regenerate-all
app.post('/api/actions/regenerate-all', async (req, res) => {
  const payload = req.body || { action: 'regenerate-all' };

  // Send to primary regenerate target server (REGENERATE_TARGET)
  let primaryResponse = null;
  try {
    if (FIRE_AND_FORGET) {
      // Kick off the request but don't wait for it
      fireAndForgetPost(REGENERATE_TARGET, payload);
      primaryResponse = { info: 'forwarded-async' };
      console.log('Regenerate-all forwarded asynchronously to REGENERATE_TARGET');
    } else {
      const resp = await postWithRetries(REGENERATE_TARGET, payload);
      primaryResponse = { status: resp.status, data: resp.data };
      console.log('Primary regenerate-all POST succeeded to REGENERATE_TARGET:', primaryResponse.status);
    }
  } catch (err) {
    console.error('Primary regenerate-all POST failed to REGENERATE_TARGET:', err.message || err.toString());
    primaryResponse = { error: err.message || String(err) };
  }

  // If an additional webhook is configured, forward the same payload to it as well
  let additionalResponse = null;
  if (ADDITIONAL_REGENERATE_WEBHOOK) {
    try {
      if (FIRE_AND_FORGET) {
        fireAndForgetPost(ADDITIONAL_REGENERATE_WEBHOOK, payload);
        additionalResponse = { info: 'forwarded-async' };
        console.log('Regenerate-all forwarded asynchronously to ADDITIONAL_REGENERATE_WEBHOOK');
      } else {
        const resp2 = await postWithRetries(ADDITIONAL_REGENERATE_WEBHOOK, payload);
        additionalResponse = { status: resp2.status, data: resp2.data };
        console.log('Additional regenerate-all POST succeeded:', additionalResponse.status);
      }
    } catch (err) {
      console.error('Additional regenerate-all POST failed:', err.message || err.toString());
      additionalResponse = { error: err.message || String(err) };
    }
  }

  // Decide what to return to the caller.
  // Prefer to return the primary webhook's response if available (status in 2xx).
  if (primaryResponse && primaryResponse.status && primaryResponse.status >= 200 && primaryResponse.status < 300) {
    // Return the same body/status as primary regenerate target server
    return res.status(primaryResponse.status).send(primaryResponse.data);
  }

  // If primary failed but additional succeeded, return the additional's success
  if (additionalResponse && additionalResponse.status && additionalResponse.status >= 200 && additionalResponse.status < 300) {
    return res.status(additionalResponse.status).send(additionalResponse.data);
  }

  // Both failed (or no responses); return a combined error
  return res.status(500).json({
    error: 'Both webhook forwards failed',
    primary: primaryResponse,
    additional: additionalResponse
  });
});

// Approve Photo: /api/actions/approve/:currentDay
// Send the original payload shape the upstream expects: { day, action: 'approved' }
app.post('/api/actions/approve/:day', async (req, res) => {
  const { day } = req.params;
  const payload = { day, action: 'approved' };
  try {
    if (FIRE_AND_FORGET) {
      fireAndForgetPost(TARGET_SERVER, payload);
      return res.status(202).json({ status: 'accepted', info: 'forwarded-async' });
    }

    const resp = await postWithRetries(TARGET_SERVER, payload);
    return res.status(resp.status).send(resp.data || `${day} has been approved`);
  } catch (err) {
    console.error(`Error sending approve POST for ${day}:`, err.message || err.toString());
    return res.status(500).send(`Failed to approve ${day}`);
  }
});

// Regenerate Single: /api/actions/regenerate-single/:currentDay
// Send the original payload shape the upstream expects: { day, action: 'regenerated' }
app.post('/api/actions/regenerate-single/:day', async (req, res) => {
  const { day } = req.params;
  const payload = { day, action: 'regenerated' };
  try {
    if (FIRE_AND_FORGET) {
      fireAndForgetPost(TARGET_SERVER, payload);
      return res.status(202).json({ status: 'accepted', info: 'forwarded-async' });
    }

    const resp = await postWithRetries(TARGET_SERVER, payload);
    return res.status(resp.status).send(resp.data || `${day} has been regenerated`);
  } catch (err) {
    console.error(`Error sending regenerate-single POST for ${day}:`, err.message || err.toString());
    return res.status(500).send(`Failed to regenerate ${day}`);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`✅ Routes:
  GET  /api/photos/:day
  POST /api/actions/regenerate-all
  POST /api/actions/approve/:day
  POST /api/actions/regenerate-single/:day`);
  if (ADDITIONAL_REGENERATE_WEBHOOK) console.log(`Forwarding regenerate-all also to: ${ADDITIONAL_REGENERATE_WEBHOOK}`);
});
