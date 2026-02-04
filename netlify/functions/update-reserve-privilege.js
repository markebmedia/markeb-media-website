// netlify/functions/update-reserve-privilege.js
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
    const { recordId, email, enabled } = JSON.parse(event.body);

    if (!recordId || !email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Record ID and email required' })
      };
    }

    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    // Update the user record
    await base(process.env.AIRTABLE_USER_TABLE || 'Markeb Media Users').update(recordId, {
      'Allow Reserve Without Payment': enabled
    });

    console.log(`✓ Updated record ${recordId} - Skip Payment: ${enabled}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Reserve privilege ${enabled ? 'enabled' : 'disabled'} for ${email}`
      })
    };

  } catch (error) {
    console.error('Error updating reserve privilege:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: 'Failed to update privilege',
        error: error.message
      })
    };
  }
};