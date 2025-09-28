// netlify/functions/track-content.js
import fetch from 'node-fetch';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const { trackingCode } = JSON.parse(event.body || '{}');
    if (!trackingCode) return { statusCode: 400, body: JSON.stringify({ message: 'trackingCode required' }) };

    const token  = process.env.AIRTABLE_TOKEN;      // set in Netlify
    const baseId = process.env.AIRTABLE_BASE_ID;    // appVzPU0icwL8H6aP
    const table  = process.env.AIRTABLE_TABLE_ID;   // tblRgcv7M9dUU3YuL
    const url = `https://api.airtable.com/v0/${baseId}/${table}?filterByFormula=${encodeURIComponent(`{Tracking Code}='${trackingCode}'`)}`;

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }});
    const json = await r.json();
    if (!json.records || json.records.length === 0) return { statusCode: 404, body: JSON.stringify({ message: 'Not found' }) };

    const f = json.records[0].fields;
    return {
      statusCode: 200,
      body: JSON.stringify({
        record: {
          status: f['Status'] || null,
          shootDate: f['Shoot Date'] || null,
          customerName: f['Customer Name'] || null,
          serviceType: f['Service Type'] || null,
          projectAddress: f['Project Address'] || null,
          deliveryLink: f['Delivery Link'] || null
        }
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ message: 'Server error', error: String(e) }) };
  }
}
