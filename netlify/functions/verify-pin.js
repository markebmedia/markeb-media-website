// netlify/functions/verify-pin.js
//
// Verifies the sales playbook PIN against the PLAYBOOK_PIN environment variable.
//
// Setup:
//   1. Go to Netlify dashboard → Your site → Site configuration → Environment variables
//   2. Add variable:  Key = PLAYBOOK_PIN   Value = your chosen 4-digit PIN
//   3. Deploy — no code changes ever needed to rotate the PIN
//
// The PIN never appears in the HTML source. Changing it requires only
// updating the environment variable and triggering a redeploy.

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Check the env variable is configured
  const correct = process.env.PLAYBOOK_PIN;
  if (!correct) {
    console.error('PLAYBOOK_PIN environment variable is not set');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'PIN not configured — add PLAYBOOK_PIN to your Netlify environment variables' })
    };
  }

  // Parse the submitted PIN
  let submitted;
  try {
    const body = JSON.parse(event.body || '{}');
    submitted = body.pin;
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid request body' })
    };
  }

  if (!submitted || typeof submitted !== 'string') {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'PIN is required' })
    };
  }

  // Compare — trim both to be safe
  const success = submitted.trim() === correct.trim();

  // Small artificial delay to slow down brute-force attempts
  await new Promise(resolve => setTimeout(resolve, 300));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      // Prevent caching of the response
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify({ success })
  };
};