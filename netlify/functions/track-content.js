// netlify/functions/track-content.js
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { message: 'Method Not Allowed' });
  }

  try {
    const { trackingCode } = JSON.parse(event.body || '{}');
    if (!trackingCode) return json(400, { message: 'trackingCode required' });

    const token  = process.env.AIRTABLE_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const mainTable = process.env.AIRTABLE_TABLE_ID;                  // main property table
    const brandingTable = process.env.AIRTABLE_BRANDING_SESSION_TABLE_ID; // branding sessions table

    if (!token || !baseId || !mainTable || !brandingTable) {
      return json(500, { message: 'Server config missing (AIRTABLE_* env vars)' });
    }

    const safe = String(trackingCode).trim().replace(/'/g, "\\'");
    const formula = `LOWER(TRIM({Tracking Code}))='${safe.toLowerCase()}'`;

    // helper to query a specific table
    async function fetchTable(tableId) {
      const url = `https://api.airtable.com/v0/${baseId}/${tableId}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.records && data.records[0]) ? data.records[0].fields : null;
    }

    // try main table first, fallback to branding
    let f = await fetchTable(mainTable);
    let source = 'main';
    if (!f) {
      f = await fetchTable(brandingTable);
      source = 'branding';
    }

    if (!f) {
      return json(404, { message: 'Not found' });
    }

    const responseData = {
      status:         f['Status'] || null,
      shootDate:      f['Shoot Date'] || null,
      customerName:   f['Customer Name'] || null,
      serviceType:    f['Service Type'] || null,
      deliveryLink:   f['Delivery Link'] || null,
      projectAddress: f['Project Address'] || null,
      source
    };

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
