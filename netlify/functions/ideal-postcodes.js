const fetch = require('node-fetch');

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
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { postcode } = JSON.parse(event.body);
    
    if (!postcode) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Postcode is required' })
      };
    }

    const cleanPostcode = postcode.replace(/\s/g, '');
    const apiKey = process.env.IDEAL_POSTCODES_API_KEY;
    
    if (!apiKey) {
      console.error('IDEAL_POSTCODES_API_KEY not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'API key not configured' })
      };
    }

    const url = `https://api.ideal-postcodes.co.uk/v1/postcodes/${cleanPostcode}?api_key=${apiKey}`;
    console.log('Calling Ideal Postcodes for:', cleanPostcode);
    
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        console.log('No addresses found for:', cleanPostcode);
        return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ addresses: [] })
        };
      }
      
      throw new Error(`Ideal Postcodes API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('Addresses found:', data.result?.length || 0);
    
    // Transform to match GetAddress.io format
    const addresses = (data.result || []).map(addr => ({
      line_1: addr.line_1 || '',
      line_2: addr.line_2 || '',
      line_3: addr.line_3 || '',
      town_or_city: addr.post_town || '',
      county: addr.county || '',
      postcode: addr.postcode || ''
    }));

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ addresses })
    };

  } catch (error) {
    console.error('Ideal Postcodes error:', error);
    return {
      statusCode: 500,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        error: 'Failed to fetch addresses',
        message: error.message 
      })
    };
  }
};