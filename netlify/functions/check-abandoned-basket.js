const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const { sendAbandonedBasketEmail } = require('./email-service');

const WAIT_HOURS = 2;       // don't email until 2 hours after email was captured
const CUTOFF_HOURS = 24;    // only send within a 24 hour window after wait period

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
    const { userEmail } = JSON.parse(event.body || '{}');
    if (!userEmail) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'userEmail required' }) };
    }

    const records = await base('Booking Funnel')
      .select({
        filterByFormula: `AND(LOWER({Client Email}) = "${userEmail.toLowerCase()}", {Status} = 'In Progress')`,
        sort: [{ field: 'Last Updated At', direction: 'desc' }],
        maxRecords: 5
      })
      .firstPage();

    if (records.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: false, reason: 'no_in_progress_session' }) };
    }

    const now = new Date();

    const candidate = records.find(r => {
      const f = r.fields;

      // Never send more than once for the same session
      if (f['Reminder Sent At']) return false;

      // Never send once completed (belt and braces — already filtered by Status above)
      if (f['Status'] === 'Completed') return false;

      const capturedAt = f['Email Captured At'] ? new Date(f['Email Captured At']) : null;
      if (!capturedAt) return false;

      const hoursSinceCapture = (now - capturedAt) / (1000 * 60 * 60);

      // Must have waited at least 2 hours, and must still be within the 24 hour window after that
      if (hoursSinceCapture < WAIT_HOURS) return false;
      if (hoursSinceCapture > (WAIT_HOURS + CUTOFF_HOURS)) return false;

      return true;
    });

    if (!candidate) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: false, reason: 'not_due_or_expired' }) };
    }

    const f = candidate.fields;
    const session = {
      clientName: f['Client Name'] || 'there',
      clientEmail: f['Client Email'],
      postcode: f['Postcode'] || '',
      propertyAddress: f['Property Address'] || '',
      service: f['Service Selected'] || '',
      basketValue: parseFloat(f['Basket Value']) || 0
    };

    await sendAbandonedBasketEmail(session);

    await base('Booking Funnel').update(candidate.id, {
      'Reminder Sent At': now.toISOString()
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: true }) };

  } catch (error) {
    console.error('check-abandoned-basket error:', error);
    return { statusCode: 200, headers, body: JSON.stringify({ success: false }) };
  }
};