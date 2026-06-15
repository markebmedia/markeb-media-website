// netlify/functions/hunter-search.js
// Hunter.io API proxy — all actions server-side, API key never exposed to browser

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
  if (!HUNTER_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'HUNTER_API_KEY not configured in environment variables' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { action, domain, firstName, lastName, email, limit = 10, offset = 0 } = body;

  try {
    let url;

    switch (action) {

      // Domain Search
      // Finds all email addresses at a given company domain.
      case 'domain-search': {
        if (!domain) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'domain is required' }) };
        }
        url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=${limit}&offset=${offset}&api_key=${HUNTER_API_KEY}`;
        break;
      }

      // Email Finder
      // Finds or constructs the most likely email for a named person at a domain.
      case 'email-finder': {
        if (!domain || !firstName || !lastName) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'domain, firstName and lastName are all required' })
          };
        }
        url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${HUNTER_API_KEY}`;
        break;
      }

      // Email Verifier
      // Checks whether an email address is valid and likely to be delivered.
      case 'email-verify': {
        if (!email) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'email is required' }) };
        }
        url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${HUNTER_API_KEY}`;
        break;
      }

      // Company Enrichment
      // Returns firmographic data: size, industry, tech stack, social links.
      case 'company-enrichment': {
        if (!domain) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'domain is required' }) };
        }
        url = `https://api.hunter.io/v2/companies/find?domain=${encodeURIComponent(domain)}&api_key=${HUNTER_API_KEY}`;
        break;
      }

      // Credits
      // Returns current credit usage and plan details.
      case 'credits': {
        url = `https://api.hunter.io/v2/account?api_key=${HUNTER_API_KEY}`;
        break;
      }

      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
    }

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      const errorMessage = data?.errors?.[0]?.details || data?.errors?.[0]?.id || 'Hunter API error';
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ success: false, error: errorMessage, raw: data })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data })
    };

  } catch (err) {
    console.error('Hunter search error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};