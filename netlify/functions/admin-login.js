// netlify/functions/admin-login.js
// Validates email + password against Admin Users table and issues a signed session token.
// Requires env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_ADMIN_USERS_TABLE, ADMIN_SESSION_SECRET

const crypto = require('crypto');

function verifyPassword(password, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: 'Method not allowed' }) };
  }

  try {
    const { email, password } = JSON.parse(event.body);

    if (!email || !password) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Email and password required' }) };
    }

    // Small artificial delay to reduce timing-based email enumeration.
    await new Promise(r => setTimeout(r, 300));

    const tableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_ADMIN_USERS_TABLE}`;
    const filterFormula = encodeURIComponent(`LOWER({Email}) = "${email.toLowerCase().trim()}"`);

    const lookupRes = await fetch(`${tableUrl}?filterByFormula=${filterFormula}`, {
      headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` }
    });

    if (!lookupRes.ok) throw new Error(`Airtable lookup error: ${lookupRes.status}`);

    const lookupData = await lookupRes.json();
    const record = (lookupData.records || [])[0];

    if (!record || record.fields['Status'] !== 'Active' || !verifyPassword(password, record.fields['Password Hash'])) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, message: 'Incorrect email or password' }) };
    }

    let permissions = [];
    try { permissions = JSON.parse(record.fields['Permissions'] || '[]'); } catch (e) { permissions = []; }

    const token = signSession({
      id: record.id,
      name: record.fields['Name'],
      email: record.fields['Email'],
      permissions,
      exp: Date.now() + 1000 * 60 * 60 * 12 // 12 hour session
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, token, name: record.fields['Name'], permissions })
    };

  } catch (error) {
    console.error('Error logging in:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: 'Login failed', error: error.message }) };
  }
};