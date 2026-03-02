// netlify/functions/specialist-auth.js

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { name, passcode } = body;

  if (!name || !passcode) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Name and passcode required' }) };
  }

  // Normalise input — trim and lowercase for comparison
  const normalisedName = name.trim().toLowerCase();
  const normalisedPasscode = passcode.trim();

  // Specialist lookup — passcodes come from environment variables
  const specialists = {
    'jodie': {
      displayName: 'Jodie',
      passcode: process.env.SPECIALIST_CODE_JODIE
    },
    'andrii': {
      displayName: 'Andrii',
      passcode: process.env.SPECIALIST_CODE_ANDRII
    }
  };

  const specialist = specialists[normalisedName];

  // Unknown name or wrong passcode — same error either way (don't reveal which is wrong)
  if (!specialist || !specialist.passcode || normalisedPasscode !== specialist.passcode) {
    // Small delay to prevent brute force
    await new Promise(r => setTimeout(r, 500));
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ success: false, error: 'Invalid credentials' })
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, name: specialist.displayName })
  };
};