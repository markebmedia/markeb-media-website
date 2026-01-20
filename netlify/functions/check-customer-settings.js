// netlify/functions/check-customer-settings.js
// Check if customer has "Reserve without payment" privilege
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

    // Check if customer exists in Airtable
    const filterFormula = `LOWER({Email}) = "${email.toLowerCase()}"`;
    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE || 'Markeb Media Users'}?filterByFormula=${encodeURIComponent(filterFormula)}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Airtable API error: ${response.status}`);
    }

    const data = await response.json();

    // If customer not found, they cannot reserve
    if (!data.records || data.records.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          customerExists: false,
          canReserve: false,
          message: 'Customer not found'
        })
      };
    }

    const customer = data.records[0];
    const canReserve = customer.fields['Allow Reserve Without Payment'] === true;
    const accountStatus = customer.fields['Account Status'];

    // Must have active account to reserve
    if (accountStatus !== 'Active') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          customerExists: true,
          canReserve: false,
          message: 'Account is not active'
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        customerExists: true,
        canReserve: canReserve,
        customerName: customer.fields['Name'],
        customerCompany: customer.fields['Company'] || '',
        accountStatus: accountStatus,
        message: canReserve ? 'Customer can reserve without payment' : 'Payment required at booking'
      })
    };

  } catch (error) {
    console.error('Error checking customer settings:', error);
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