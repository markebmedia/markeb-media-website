// netlify/functions/admin-invite.js
// Creates a pending Admin User record and emails them a set-password link.
// Requires a valid session belonging to someone with 'team-access' (or '*')
// permission — checked server-side, not just hidden in the UI.
// Requires env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_ADMIN_USERS_TABLE,
//                     RESEND_API_KEY, SITE_URL, ADMIN_SESSION_SECRET

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

// Minimal HTML-escaping so a crafted name/email can't inject markup into the
// invite email or later break the Team Access list rendering.
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
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

  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_ADMIN_USERS_TABLE) {
    console.error('Missing required environment variables');
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: 'Server configuration error' }) };
  }

  const caller = await requireTeamAccess(event);
  if (!caller) {
    return { statusCode: 401, headers, body: JSON.stringify({ success: false, message: 'Not authorised' }) };
  }

  try {
    const { name, email, permissions } = JSON.parse(event.body);

    if (!name || !email || !Array.isArray(permissions)) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Missing name, email or permissions' }) };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString();

    const tableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_ADMIN_USERS_TABLE}`;

    const createRes = await fetch(tableUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          'Name': name,
          'Email': email.toLowerCase().trim(),
          'Invite Token': token,
          'Invite Token Expires': expires,
          'Status': 'Pending',
          'Permissions': JSON.stringify(permissions),
          'Created Date': new Date().toISOString()
        }
      })
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error('Airtable create error:', createRes.status, errText);
      throw new Error(`Airtable error: ${createRes.status}`);
    }

    const inviteLink = `${process.env.SITE_URL}/admin-set-password.html?token=${token}`;
    const safeName = escapeHtml(name);

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Markeb Media <no-reply@markebmedia.com>',
        to: email,
        subject: 'You have been invited to the Markeb Media admin panel',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color:#0f172a;">You're invited, ${safeName}</h2>
            <p style="color:#475569;">You have been given access to the Markeb Media admin panel. Click below to set your password and get started.</p>
            <p style="margin: 24px 0;">
              <a href="${inviteLink}" style="background:#B46100;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Set your password</a>
            </p>
            <p style="color:#94a3b8;font-size:12px;">This link expires in 72 hours. If you weren't expecting this, ignore this email.</p>
          </div>
        `
      })
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error('Resend error:', emailRes.status, errText);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error('Error inviting user:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: 'Failed to send invite', error: error.message }) };
  }
};