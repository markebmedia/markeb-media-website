// lib/xero-client.js
// Shared helper for all Xero interactions. Handles token refresh and
// authenticated requests so individual functions don't repeat this logic.

const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const INTEGRATIONS_TABLE = 'Integrations';

const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID;
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET;
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';

// Fetch the stored Xero connection record from Airtable
async function getXeroConnection() {
  const records = await base(INTEGRATIONS_TABLE)
    .select({ filterByFormula: `{service} = 'xero'`, maxRecords: 1 })
    .firstPage();

  if (!records.length) {
    throw new Error('No Xero connection found. Connect via admin panel first.');
  }
  return records[0];
}

// Update the stored tokens after a refresh
async function saveXeroConnection(recordId, fields) {
  await base(INTEGRATIONS_TABLE).update(recordId, fields);
}

// Refresh the access token using the stored refresh token.
// Xero refresh tokens rotate on every use — always save the new one.
async function refreshAccessToken() {
  const record = await getXeroConnection();
  const refreshToken = record.get('refresh_token');

  const response = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Xero token refresh failed: ${errText}`);
  }

  const data = await response.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await saveXeroConnection(record.id, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
  });

  return {
    accessToken: data.access_token,
    tenantId: record.get('tenant_id'),
  };
}

// Get a valid access token, refreshing if it's expired or about to expire
async function getValidAccessToken() {
  const record = await getXeroConnection();
  const expiresAt = new Date(record.get('expires_at'));
  const bufferMs = 2 * 60 * 1000; // refresh 2 min before actual expiry

  if (Date.now() > expiresAt.getTime() - bufferMs) {
    return refreshAccessToken();
  }

  return {
    accessToken: record.get('access_token'),
    tenantId: record.get('tenant_id'),
  };
}

// Make an authenticated request to the Xero Accounting API
async function xeroRequest(path, options = {}) {
  const { accessToken, tenantId } = await getValidAccessToken();

  const response = await fetch(`${XERO_API_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Xero-tenant-id': tenantId,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Xero API error (${response.status}): ${errText}`);
  }

  return response.json();
}

module.exports = {
  getXeroConnection,
  saveXeroConnection,
  refreshAccessToken,
  getValidAccessToken,
  xeroRequest,
};