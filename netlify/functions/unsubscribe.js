const { Resend } = require('resend');
const Airtable = require('airtable');

const resend = new Resend(process.env.RESEND_API_KEY);
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { email } = JSON.parse(event.body);

    if (!email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email is required' }) };
    }

    // Find user in Airtable
    const records = await base('Markeb Media Users')
      .select({ filterByFormula: `{Email} = '${email}'`, maxRecords: 1 })
      .all();

    if (records.length > 0) {
      // Update Email Notifications Enabled to false
      await base('Markeb Media Users').update(records[0].id, {
        'Email Notifications Enabled': false
      });
    }

    // Notify us
    await resend.emails.send({
      from: 'Markeb Media <commercial@markebmedia.com>',
      to: 'commercial@markebmedia.com',
      subject: `Unsubscribe Request — ${email}`,
      html: `
        <p><strong>${email}</strong> has requested to unsubscribe from broadcast emails.</p>
        <p>Their <em>Email Notifications Enabled</em> flag has been set to false in Airtable.</p>
        <p>If you need to take any further action, please update their record manually.</p>
      `
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };

  } catch (error) {
    console.error('Unsubscribe error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};