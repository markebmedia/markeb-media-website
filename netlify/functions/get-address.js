const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { postcode } = JSON.parse(event.body);

    if (!postcode) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Postcode is required' })
      };
    }

    // Clean postcode
    const cleanPostcode = postcode.replace(/\s/g, '');
    
    // Get API key from environment variable
    const apiKey = process.env.GET_ADDRESS_API_KEY;
    
    if (!apiKey) {
      console.error('GET_ADDRESS_API_KEY not configured');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'API key not configured' })
      };
    }

    // Call GetAddress.io API
    const url = `https://api.getAddress.io/find/${cleanPostcode}?api-key=${apiKey}&expand=true`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) {
        return {
          statusCode: 200,
          body: JSON.stringify({ addresses: [] })
        };
      }
      throw new Error(`GetAddress API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        addresses: data.addresses || []
      })
    };

  } catch (error) {
    console.error('GetAddress function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to fetch addresses',
        message: error.message 
      })
    };
  }
};