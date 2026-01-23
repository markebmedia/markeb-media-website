// netlify/functions/airtable-proxy.js
// Proxy for Airtable API calls from admin panel
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
    const { method, url, table, recordId, body, filterFormula } = JSON.parse(event.body);
    let finalUrl;
    
    // Build URL from table name
    if (table) {
      // Convert spaces to underscores for env var lookup
      const envVarName = `AIRTABLE_${table.toUpperCase().replace(/\s+/g, '_')}_TABL`;
      const tableId = process.env[envVarName];
      
      if (!tableId) {
        console.error(`Table configuration not found: ${envVarName}`);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: `Table configuration not found: ${envVarName}`,
            hint: `Please add ${envVarName} to your Netlify environment variables`
          })
        };
      }
      
      const baseUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${tableId}`;
      
      if (recordId) {
        finalUrl = `${baseUrl}/${recordId}`;
      } else if (filterFormula) {
        finalUrl = `${baseUrl}?filterByFormula=${encodeURIComponent(filterFormula)}`;
      } else {
        finalUrl = baseUrl;
      }
    } else {
      // Fallback: use provided URL (for backward compatibility)
      finalUrl = url;
    }

    const options = {
      method: method,
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(finalUrl, options);
    const data = await response.json();

    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.error('Airtable proxy error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Proxy request failed',
        details: error.message
      })
    };
  }
};