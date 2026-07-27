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

// Capture moment: whichever email becomes known FIRST — either the logged-in
// dashboard Account Email (known instantly at session start) or the manually
// typed Client Email (only known from step 5 onward). Account Email takes
// priority since it's how we identify who's actually sitting in the funnel.
const updateFields = { ...fields, 'Last Updated At': now };

const emailFromFields = (fields && (fields['Account Email'] || fields['Client Email'])) || null;

if (existing.length > 0) {
      const hadEmailBefore = !!(existing[0].fields['Account Email'] || existing[0].fields['Client Email']);
      if (!hadEmailBefore && emailFromFields) {
        updateFields['Email Captured At'] = now;
      }
await base('Booking Funnel').update(existing[0].id, updateFields);
    } else {
      if (emailFromFields) {
        updateFields['Email Captured At'] = now;
      }
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