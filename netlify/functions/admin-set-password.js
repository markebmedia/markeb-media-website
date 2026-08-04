// netlify/functions/admin-set-password.js
// Validates an invite token and sets the user's password hash.
// Requires env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_ADMIN_USERS_TABLE

const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
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
    const { token, password } = JSON.parse(event.body);

    if (!token || !password || password.length < 8) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Invalid token or password too short (min 8 characters)' }) };
    }

    const tableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_ADMIN_USERS_TABLE}`;
    const filterFormula = encodeURIComponent(`{Invite Token} = "${token}"`);

    const lookupRes = await fetch(`${tableUrl}?filterByFormula=${filterFormula}`, {
      headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` }
    });

    if (!lookupRes.ok) throw new Error(`Airtable lookup error: ${lookupRes.status}`);

    const lookupData = await lookupRes.json();
    const record = (lookupData.records || [])[0];

    if (!record) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, message: 'Invite link is invalid or already used' }) };
    }

    const expires = record.fields['Invite Token Expires'];
    if (expires && new Date(expires).getTime() < Date.now()) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, message: 'Invite link has expired — ask an admin to resend it' }) };
    }

    const patchRes = await fetch(`${tableUrl}/${record.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          'Password Hash': hashPassword(password),
          'Status': 'Active',
          'Invite Token': ''
        }
      })
    });

    if (!patchRes.ok) throw new Error(`Airtable update error: ${patchRes.status}`);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error('Error setting password:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: 'Failed to set password', error: error.message }) };
  }
};