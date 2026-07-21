const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { sessionId, fields } = JSON.parse(event.body);
    if (!sessionId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'sessionId required' }) };
    }

    const now = new Date().toISOString();

    const existing = await base('Booking Funnel')
      .select({ filterByFormula: `{Session ID} = '${sessionId}'`, maxRecords: 1 })
      .firstPage();

    const updateFields = { ...fields, 'Last Updated At': now };

    if (existing.length > 0) {
      await base('Booking Funnel').update(existing[0].id, updateFields);
    } else {
      await base('Booking Funnel').create({
        'Session ID': sessionId,
        'Started At': now,
        'Status': 'In Progress',
        ...updateFields
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error('track-booking-funnel error:', error);
    // Never let tracking failures affect the booking flow itself
    return { statusCode: 200, headers, body: JSON.stringify({ success: false }) };
  }
};