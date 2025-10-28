// netlify/functions/track-content.js
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { message: 'Method Not Allowed' });
  }

  try {
    const { trackingCode } = JSON.parse(event.body || '{}');
    if (!trackingCode) return json(400, { message: 'trackingCode required' });

    const token  = process.env.AIRTABLE_TOKEN;                      // set in Netlify
const baseId = process.env.AIRTABLE_BASE_ID;                    // e.g. appVzPU0icwL8H6aP
const table  = process.env.AIRTABLE_BRANDING_SESSION_TABLE_ID;  // e.g. tblGjnjL74WwwxUlZ
if (!token || !baseId || !table) {
  return json(500, { message: 'Server config missing (AIRTABLE_* env vars)' });
}


    // Safer, tolerant formula: trim + lowercase + escape single quotes
    const safe = String(trackingCode).trim().replace(/'/g, "\\'");
    const formula = `LOWER(TRIM({Tracking Code}))='${safe.toLowerCase()}'`;
    const url = `https://api.airtable.com/v0/${baseId}/${table}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      // Surface Airtable's error so you can diagnose (401/403/422/etc.)
      const errText = await r.text().catch(() => '');
      return {
        statusCode: r.status,
        headers: { 'Content-Type': 'application/json' },
        body: errText || JSON.stringify({ message: 'Airtable request failed' })
      };
    }

    const data = await r.json();
    if (!data.records || data.records.length === 0) {
      return json(404, { message: 'Not found' });
    }

    const f = data.records[0].fields || {};

    // ✅ Base response (always included)
    const responseData = {
      status:         f['Status'] || null,
      shootDate:      f['Shoot Date'] || null,
      customerName:   f['Customer Name'] || null,
      serviceType:    f['Service Type'] || null,
      deliveryLink:   f['Delivery Link'] || null
    };

    // ✅ Only include projectAddress if not from Branding Sessions Bookings
    if (table !== 'Branding Sessions Bookings') {
      responseData.projectAddress = f['Project Address'] || null;
    }

    return json(200, { record: responseData });

  } catch (e) {
    return json(500, { message: 'Server error', error: String(e) });
  }
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}
