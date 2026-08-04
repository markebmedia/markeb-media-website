// netlify/functions/admin-users-update.js
// Updates an Admin User's permissions, or deletes their account.
// Requires env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_ADMIN_USERS_TABLE

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
    const { recordId, permissions, remove } = JSON.parse(event.body);

    if (!recordId) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Missing recordId' }) };
    }

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