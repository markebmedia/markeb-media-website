const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const { sendAbandonedBasketEmail } = require('./email-service');

const WAIT_HOURS = 2;       // don't email until 2 hours after email was captured
const CUTOFF_HOURS = 24;    // only send within a 24 hour window after wait period

// This function runs on a schedule (see netlify.toml / schedule config below)
// rather than being triggered by any user action — so reminders go out even
// if the client never revisits the dashboard.
exports.handler = async (event) => {
  try {
    const now = new Date();

    const records = await base('Booking Funnel')
      .select({
        filterByFormula: `{Status} = 'In Progress'`,
        sort: [{ field: 'Last Updated At', direction: 'desc' }]
      })
      .all(); // .all() paginates automatically — scans every eligible record, not just page 1

    let sentCount = 0;
    let checkedCount = 0;

    for (const record of records) {
      checkedCount++;
      const f = record.fields;

      // Never send more than once for the same session
      if (f['Reminder Sent At']) continue;

      const emailAddress = f['Account Email'] || f['Client Email'];
      if (!emailAddress) continue; // no email captured yet — nothing to send to

      const capturedAt = f['Email Captured At'] ? new Date(f['Email Captured At']) : null;
      if (!capturedAt) continue;

      const hoursSinceCapture = (now - capturedAt) / (1000 * 60 * 60);

      // Must have waited at least 2 hours, and must still be within the
      // 24 hour window after that — otherwise treat as expired/too late
      if (hoursSinceCapture < WAIT_HOURS) continue;
      if (hoursSinceCapture > (WAIT_HOURS + CUTOFF_HOURS)) continue;

      const session = {
        clientName: f['Client Name'] || f['Account Name'] || 'there',
        clientEmail: emailAddress,
        postcode: f['Postcode'] || '',
        propertyAddress: f['Property Address'] || '',
        service: f['Service Selected'] || '',
        basketValue: parseFloat(f['Basket Value']) || 0
      };

      try {
        await sendAbandonedBasketEmail(session);
        await base('Booking Funnel').update(record.id, {
          'Reminder Sent At': now.toISOString()
        });
        sentCount++;
      } catch (sendErr) {
        console.error(`Failed to send reminder for record ${record.id}:`, sendErr);
        // Continue processing other records even if one email fails
      }
    }

    console.log(`Abandoned basket sweep complete: checked ${checkedCount}, sent ${sentCount}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, checked: checkedCount, sent: sentCount })
    };

  } catch (error) {
    console.error('send-abandoned-basket-reminders error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

// Netlify Scheduled Function config — runs every 15 minutes
exports.config = {
  schedule: '*/15 * * * *'
};