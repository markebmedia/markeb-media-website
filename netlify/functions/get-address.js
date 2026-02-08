const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🚀 GetAddress function invoked');
  console.log('📝 Event method:', event.httpMethod);
  
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    console.log('✅ Handling OPTIONS preflight');
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    console.log('❌ Method not allowed:', event.httpMethod);
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    console.log('📦 Request body:', event.body);
    const { postcode } = JSON.parse(event.body);
    console.log('🔍 Postcode received:', postcode);
    
    if (!postcode) {
      console.log('❌ No postcode provided');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Postcode is required' })
      };
    }

    // Clean postcode
    const cleanPostcode = postcode.replace(/\s/g, '');
    console.log('🧹 Cleaned postcode:', cleanPostcode);
    
    // Get API key from environment variable
    const apiKey = process.env.GET_ADDRESS_API_KEY;
    
    if (!apiKey) {
      console.error('❌ GET_ADDRESS_API_KEY not configured in environment');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'API key not configured' })
      };
    }
    
    console.log('✅ API key found (length:', apiKey.length, ')');

    // Call GetAddress.io API
    const url = `https://api.getAddress.io/find/${cleanPostcode}?api-key=${apiKey}&expand=true`;
    console.log('📡 Calling GetAddress API for:', cleanPostcode);
    console.log('🔗 URL:', url.replace(apiKey, 'REDACTED'));
    
    const response = await fetch(url);
    console.log('📡 GetAddress API response status:', response.status);
    console.log('📡 GetAddress API response ok:', response.ok);

    if (!response.ok) {
      if (response.status === 404) {
        console.log('ℹ️ No addresses found for postcode:', cleanPostcode);
        return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ addresses: [] })
        };
      }
      
      const errorText = await response.text();
      console.error('❌ GetAddress API error:', response.status, errorText);
      throw new Error(`GetAddress API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('📦 Raw API response:', JSON.stringify(data, null, 2));
    console.log('📊 Number of addresses returned:', data.addresses?.length || 0);
    
    if (data.addresses && data.addresses.length > 0) {
      console.log('✅ First address sample:', data.addresses[0]);
    }

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
    console.error('❌ GetAddress function error:', error);
    console.error('❌ Error stack:', error.stack);
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