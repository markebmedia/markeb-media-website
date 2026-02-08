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
    const apiKey = process.env.GET_ADDRESS_API_KEY;
    
    if (!apiKey) {
      console.error('GET_ADDRESS_API_KEY not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'API key not configured' })
      };
    }

    const url = `https://api.getAddress.io/find/${cleanPostcode}?api-key=${apiKey}&expand=true`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ addresses: [] })
        };
      }
      
      throw new Error(`GetAddress API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        ...headers,
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