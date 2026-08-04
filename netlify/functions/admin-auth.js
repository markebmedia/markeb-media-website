// netlify/functions/admin-auth.js
// Verifies a signed session token AND re-checks the account is still Active in Airtable.
// This means removing someone in Team Access logs them out on their next check,
// rather than waiting for their token to naturally expire.
// Requires env vars: ADMIN_SESSION_SECRET, AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_ADMIN_USERS_TABLE

const crypto = require('crypto');

function verifySessionSignature(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig || '');
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (e) { return null; }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { token } = JSON.parse(event.body || '{}');
  const session = verifySessionSignature(token);

  if (!session) {
    await new Promise(r => setTimeout(r, 300));
    return { statusCode: 401, headers, body: JSON.stringify({ success: false }) };
  }

  // Re-check against Airtable: account must still exist and be Active.
  // Also pulls permissions live, so changes in Team Access apply immediately.
  try {
    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_ADMIN_USERS_TABLE}/${session.id}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` }
    });

    if (!res.ok) {
      // Record deleted (404) or otherwise inaccessible — treat as logged out.
      return { statusCode: 401, headers, body: JSON.stringify({ success: false }) };
    }

    const record = await res.json();

    if (record.fields['Status'] !== 'Active') {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false }) };
    }

    let permissions = [];
    try { permissions = JSON.parse(record.fields['Permissions'] || '[]'); } catch (e) { permissions = []; }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        name: record.fields['Name'],
        email: record.fields['Email'],
        permissions
      })
    };
  } catch (error) {
    console.error('Error re-verifying session against Airtable:', error);
    return { statusCode: 401, headers, body: JSON.stringify({ success: false }) };
  }
};