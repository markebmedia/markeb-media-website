// netlify/functions/airtable-proxy.js
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
    const { method, url, table, recordId, body, filterFormula, sort } = JSON.parse(event.body);

    let finalUrl;

    if (table) {
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
      } else {
        // Build query string
        const params = new URLSearchParams();
        if (filterFormula) params.set('filterByFormula', filterFormula);
        if (sort && Array.isArray(sort)) {
          sort.forEach((s, i) => {
            params.set(`sort[${i}][field]`, s.field);
            if (s.direction) params.set(`sort[${i}][direction]`, s.direction);
          });
        }
        finalUrl = params.toString() ? `${baseUrl}?${params}` : baseUrl;
      }
    } else {
      finalUrl = url;
    }

    const fetchOptions = {
      method: method,
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    // For GET requests without a specific record, paginate through all results
    if (method === 'GET' && !recordId) {
      let allRecords = [];
      let offset = null;

      do {
        const pageUrl = offset ? `${finalUrl}${finalUrl.includes('?') ? '&' : '?'}offset=${offset}` : finalUrl;
        const response = await fetch(pageUrl, fetchOptions);
        const data = await response.json();

        if (!response.ok) {
          return { statusCode: response.status, headers, body: JSON.stringify(data) };
        }

        if (data.records) {
          allRecords = allRecords.concat(data.records);
        }

        offset = data.offset || null;
      } while (offset);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ records: allRecords })
      };
    }

    // For all other requests (POST, PATCH, DELETE, GET single record) — single fetch
    const response = await fetch(finalUrl, fetchOptions);
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