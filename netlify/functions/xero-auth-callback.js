// netlify/functions/xero-auth-callback.js
// Xero redirects here after the admin approves access.
// Exchanges the auth code for tokens, fetches the connected tenant, stores it all in Airtable.

const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const INTEGRATIONS_TABLE = 'Integrations';

exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  if (error) {
    return { statusCode: 400, body: `Xero returned an error: ${error}` };
  }
  if (!code) {
    return { statusCode: 400, body: 'Missing authorization code' };
  }

  const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID;
  const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET;
  const REDIRECT_URI = process.env.XERO_REDIRECT_URI;

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${errText}`);
    }

    const tokens = await tokenResponse.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Fetch which Xero organisation(s) this connection grants access to
    const connectionsResponse = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const connections = await connectionsResponse.json();

    if (!connections.length) {
      throw new Error('No Xero organisation returned in connections');
    }

    // If you only ever connect one Xero org, take the first. If you'll support
    // multiple orgs later, loop over `connections` and create one record per tenant.
    const tenant = connections[0];

    // Upsert: check if a Xero integration record already exists, update it; else create
    const existing = await base(INTEGRATIONS_TABLE)
      .select({ filterByFormula: `{service} = 'xero'`, maxRecords: 1 })
      .firstPage();

    const fields = {
      service: 'xero',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      tenant_id: tenant.tenantId,
      tenant_name: tenant.tenantName,
      connected_at: new Date().toISOString(),
      status: 'connected',
    };

    if (existing.length) {
      await base(INTEGRATIONS_TABLE).update(existing[0].id, fields);
    } else {
      await base(INTEGRATIONS_TABLE).create([{ fields }]);
    }

    // Redirect back to admin panel with a success flag
    return {
      statusCode: 302,
      headers: { Location: '/admin.html?xero=connected' },
      body: '',
    };
  } catch (err) {
    console.error('Xero callback error:', err);
    return {
      statusCode: 302,
      headers: { Location: `/admin.html?xero=error&message=${encodeURIComponent(err.message)}` },
      body: '',
    };
  }
};