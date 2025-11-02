// netlify/functions/request-password-reset.js
const Airtable = require('airtable');
const fetch = require('node-fetch'); // ✅ Required for Node 16/18

// Configure Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

// Generate 6-digit reset code
function generateResetCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method not allowed' }) };

  try {
    const { email } = JSON.parse(event.body || '{}');

    if (!email) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'Email is required' }) };
    }

    // ✅ Use the correct table name
    const records = await base('Markeb Media Users').select({
      filterByFormula: `{Email} = "${email}"`,
      maxRecords: 1
    }).firstPage();

    if (records.length === 0) {
      // Don't reveal if email exists
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'If this email exists, a reset code has been sent.' })
      };
    }

    const user = records[0];
    const resetCode = generateResetCode();
    const expiryTime = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await base('Markeb Media Users').update(user.id, {
      'Reset Token': resetCode,
      'Reset Token Expiry': expiryTime.toISOString()
    });

    // ✅ Correct EmailJS variable names
    const emailResponse = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        template_params: {
          email, // 👈 must match {{email}} in EmailJS template
          to_name: user.fields.Name || 'Customer',
          reset_code: resetCode,
          expiry_minutes: '30'
        }
      })
    });

    if (!emailResponse.ok) {
      const text = await emailResponse.text();
      console.error('EmailJS send failed:', text);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Reset code sent to your email.', success: true })
    };

  } catch (error) {
    console.error('Error details:', error.message, error.stack);
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Internal server error', details: error.message }) };
  }
};
