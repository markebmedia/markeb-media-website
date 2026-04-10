// netlify/functions/check-account-status.js

const Airtable = require('airtable');

exports.handler = async (event) => {
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

    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    const records = await base('Markeb Media Users')
      .select({
        filterByFormula: `LOWER({Email}) = '${email.toLowerCase().replace(/'/g, "\\'")}'`,
        maxRecords: 1,
        fields: ['Email', 'Account Status', 'Suspension Reason']
      })
      .firstPage();

    if (records.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          accountStatus: 'Active',
          suspended: false
        })
      };
    }

    const user = records[0];
    const accountStatus = user.fields['Account Status'] || 'Active';
    const suspensionReason = user.fields['Suspension Reason'] || '';
    const suspended = accountStatus === 'Suspended';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        accountStatus,
        suspended,
        suspensionReason
      })
    };

  } catch (error) {
    console.error('Check account status error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};