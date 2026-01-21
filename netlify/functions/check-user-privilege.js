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
      // User not found - no privilege
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          canReserve: false,
          message: 'User not found'
        })
      };
    }

    const user = records[0];
    const canReserve = user.fields['Allow Reserve Without Payment'] === true;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        canReserve: canReserve,
        userName: user.fields['Name'] || ''
      })
    };

  } catch (error) {
    console.error('Error checking user privilege:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        canReserve: false,
        error: error.message 
      })
    };
  }
};