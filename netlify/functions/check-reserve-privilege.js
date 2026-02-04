// netlify/functions/check-reserve-privilege.js
exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const { email } = JSON.parse(event.body);

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Email required' })
      };
    }

    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    // Find user by email
    const records = await base(process.env.AIRTABLE_USER_TABLE || 'Markeb Media Users')
      .select({
        filterByFormula: `{Email} = '${email}'`,
        maxRecords: 1
      })
      .firstPage();

    if (records.length === 0) {
      // New customer - no privilege
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          skipPayment: false,  // ✅ NEW: can they skip payment entirely?
          isNewCustomer: true
        })
      };
    }

    const user = records[0];
    const skipPayment = user.fields['Allow Reserve Without Payment'] === true;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        skipPayment: skipPayment,  // ✅ NEW: can they skip payment entirely?
        isNewCustomer: false
      })
    };

  } catch (error) {
    console.error('Error checking reserve privilege:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
};