// netlify/functions/admin-invite.js
// Creates a pending Admin User record and emails them a set-password link.
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

  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_ADMIN_USERS_TABLE) {
    console.error('Missing required environment variables');
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: 'Server configuration error' }) };
  }

  try {
    const { name, email, permissions } = JSON.parse(event.body);

    if (!name || !email || !Array.isArray(permissions)) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Missing name, email or permissions' }) };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString(); // 72 hour expiry

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
            <h2 style="color:#0f172a;">You're invited, ${name}</h2>
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
      // Record is created either way — invite can be resent later.
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error('Error inviting user:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: 'Failed to send invite', error: error.message }) };
  }
};