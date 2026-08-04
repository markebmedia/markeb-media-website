// netlify/functions/admin-users-update.js
// Updates permissions or removes an Admin User. Requires a valid session
// belonging to someone with 'team-access' (or '*') permission — checked
// server-side, not just hidden in the UI.
// Requires env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_ADMIN_USERS_TABLE, ADMIN_SESSION_SECRET

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

async function requireTeamAccess(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const session = verifySessionSignature(token);
  if (!session) return null;

  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_ADMIN_USERS_TABLE}/${session.id}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  if (!res.ok) return null;

  const record = await res.json();
  if (record.fields['Status'] !== 'Active') return null;

  let permissions = [];
  try { permissions = JSON.parse(record.fields['Permissions'] || '[]'); } catch (e) { permissions = []; }
  if (!permissions.includes('*') && !permissions.includes('team-access')) return null;

  return { id: session.id, permissions };
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: 'Method not allowed' }) };
  }

  const caller = await requireTeamAccess(event);
  if (!caller) {
    return { statusCode: 401, headers, body: JSON.stringify({ success: false, message: 'Not authorised' }) };
  }

  try {
    const { recordId, permissions, remove } = JSON.parse(event.body);
    if (!recordId) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Missing recordId' }) };
    }

    // Prevent someone removing or downgrading their own only full-access account by accident via API misuse.
    // (Not a hard block — just a safety note if you ever want to add one. Left permissive here by design.)

    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_ADMIN_USERS_TABLE}/${recordId}`;

    if (remove) {
      const delRes = await fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` }
      });
      if (!delRes.ok) throw new Error(`Airtable delete error: ${delRes.status}`);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (!Array.isArray(permissions)) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Missing permissions array' }) };
    }

    const patchRes = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: { 'Permissions': JSON.stringify(permissions) } })
    });
    if (!patchRes.ok) throw new Error(`Airtable update error: ${patchRes.status}`);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (error) {
    console.error('Error updating admin user:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: 'Failed to update user', error: error.message }) };
  }
};