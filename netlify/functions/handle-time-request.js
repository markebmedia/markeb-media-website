const Airtable = require('airtable');
const { sendTimeRequestApproval, sendTimeRequestDecline } = require('./email-service');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { action, recordId, alternativeDates } = JSON.parse(event.body);

    // Fetch the request record
    const record = await base('Time Requests').find(recordId);
    const f = record.fields;

    const dateObj = new Date(f['Requested Date'] + 'T12:00:00');
    const formattedDate = dateObj.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    if (action === 'approve') {
      // Update status in Airtable
      await base('Time Requests').update(recordId, { 'Status': 'Approved' });

      await sendTimeRequestApproval(f, formattedDate);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, action: 'approved' })
      };
    }

    if (action === 'decline') {
      // Update status and store alternative dates
      await base('Time Requests').update(recordId, {
        'Status': 'Declined',
        'Alternative Dates': alternativeDates || ''
      });

      await sendTimeRequestDecline(f, formattedDate, alternativeDates);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, action: 'declined' })
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid action' })
    };

  } catch (error) {
    console.error('Handle time request error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};