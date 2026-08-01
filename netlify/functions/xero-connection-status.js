// netlify/functions/xero-connection-status.js
// Returns whether Xero is currently connected, for the admin panel status badge.

const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const INTEGRATIONS_TABLE = 'Integrations';

exports.handler = async () => {
  try {
    const records = await base(INTEGRATIONS_TABLE)
      .select({ filterByFormula: `{service} = 'xero'`, maxRecords: 1 })
      .firstPage();

    if (!records.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ connected: false }),
      };
    }

    const f = records[0].fields;
    return {
      statusCode: 200,
      body: JSON.stringify({
        connected: f.status === 'connected',
        tenantName: f.tenant_name || '',
        connectedAt: f.connected_at || '',
      }),
    };
  } catch (err) {
    console.error('Error checking Xero connection status:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};