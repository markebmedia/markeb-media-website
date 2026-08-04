// netlify/functions/admin-users-list.js
// Lists all Admin User accounts (name, email, status, permissions) for the Team Access screen.
// Requires env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_ADMIN_USERS_TABLE

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: 'Method not allowed' }) };
  }

  try {
    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_ADMIN_USERS_TABLE}?sort%5B0%5D%5Bfield%5D=Created%20Date&sort%5B0%5D%5Bdirection%5D=desc`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` }
    });

    if (!response.ok) throw new Error(`Airtable API error: ${response.status}`);

    const data = await response.json();

    const users = (data.records || []).map(r => ({
      id: r.id,
      name: r.fields['Name'],
      email: r.fields['Email'],
      status: r.fields['Status'],
      permissions: (() => { try { return JSON.parse(r.fields['Permissions'] || '[]'); } catch (e) { return []; } })()
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, users }) };

  } catch (error) {
    console.error('Error fetching admin users:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: 'Failed to load users', error: error.message }) };
  }
};