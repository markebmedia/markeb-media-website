// netlify/functions/admin-forgot-password.js
// Sends a password reset link to an existing Active Admin User.
// Reuses the same Invite Token mechanism and the admin-set-password.html page.
// Requires env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_ADMIN_USERS_TABLE,
//                     RESEND_API_KEY, SITE_URL

const crypto = require('crypto');

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
    const { email } = JSON.parse(event.body);
    if (!email) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Email required' }) };
    }

    const tableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_ADMIN_USERS_TABLE}`;
    const filterFormula = encodeURIComponent(`LOWER({Email}) = "${email.toLowerCase().trim()}"`);

    const lookupRes = await fetch(`${tableUrl}?filterByFormula=${filterFormula}`, {
      headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` }
    });
    if (!lookupRes.ok) throw new Error(`Airtable lookup error: ${lookupRes.status}`);

    const lookupData = await lookupRes.json();
    const record = (lookupData.records || [])[0];

    // Always return success even if no account exists — avoids leaking which emails have accounts.
    if (!record) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString(); // 2 hour expiry for resets

    const patchRes = await fetch(`${tableUrl}/${record.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: { 'Invite Token': token, 'Invite Token Expires': expires } })
    });
    if (!patchRes.ok) throw new Error(`Airtable update error: ${patchRes.status}`);

    const resetLink = `${process.env.SITE_URL}/admin-set-password.html?token=${token}`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Markeb Media <no-reply@markebmedia.com>',
        to: record.fields['Email'],
        subject: 'Reset your Markeb Media admin password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color:#0f172a;">Reset your password</h2>
            <p style="color:#475569;">Click below to set a new password for your Markeb Media admin account.</p>
            <p style="margin: 24px 0;">
              <a href="${resetLink}" style="background:#B46100;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Reset password</a>
            </p>
            <p style="color:#94a3b8;font-size:12px;">This link expires in 2 hours. If you didn't request this, ignore this email.</p>
          </div>
        `
      })
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error('Error sending reset link:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: 'Failed to send reset link', error: error.message }) };
  }
};