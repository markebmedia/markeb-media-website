// netlify/functions/expire-retainers.js
// Scheduled function — runs daily to auto-expire retainer contracts whose
// term has elapsed, even if nobody opens the admin panel that day.
// Checks the Retainer Clients table for any record where Status = "Active"
// and Expiry Date <= today, then flips Status to "Expired".

exports.handler = async (event, context) => {
  try {
    const tableId = process.env.AIRTABLE_RETAINER_CLIENTS_TABL;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const apiKey = process.env.AIRTABLE_API_KEY;

    if (!tableId || !baseId || !apiKey) {
      console.error('Missing required environment variables for expire-retainers');
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: 'Missing AIRTABLE_RETAINER_CLIENTS_TABL, AIRTABLE_BASE_ID, or AIRTABLE_API_KEY'
        })
      };
    }

    const today = new Date().toISOString().split('T')[0];

    // Find all Active retainers whose Expiry Date has passed
    const filterFormula = `AND({Status} = "Active", IS_BEFORE({Expiry Date}, TODAY()))`;
    const searchUrl = `https://api.airtable.com/v0/${baseId}/${tableId}?filterByFormula=${encodeURIComponent(filterFormula)}`;

    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!searchResponse.ok) {
      const errBody = await searchResponse.text();
      console.error('Airtable search failed:', errBody);
      return {
        statusCode: searchResponse.status,
        body: JSON.stringify({ success: false, error: 'Failed to query Retainer Clients table', details: errBody })
      };
    }

    const searchData = await searchResponse.json();
    const toExpire = searchData.records || [];

    if (toExpire.length === 0) {
      console.log('expire-retainers: no contracts to expire today');
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, expiredCount: 0, message: 'No contracts needed expiring' })
      };
    }

    // Airtable PATCH allows updating up to 10 records per request
    const chunks = [];
    for (let i = 0; i < toExpire.length; i += 10) {
      chunks.push(toExpire.slice(i, i + 10));
    }

    let expiredCount = 0;
    const expiredClients = [];

    for (const chunk of chunks) {
      const patchBody = {
        records: chunk.map(r => ({
          id: r.id,
          fields: { 'Status': 'Expired' }
        }))
      };

      const patchResponse = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(patchBody)
      });

      if (patchResponse.ok) {
        const patchData = await patchResponse.json();
        expiredCount += patchData.records.length;
        chunk.forEach(r => {
          expiredClients.push({
            name: r.fields['Client Name'] || 'Unknown',
            email: r.fields['Client Email'] || '',
            expiryDate: r.fields['Expiry Date'] || ''
          });
        });
      } else {
        const errBody = await patchResponse.text();
        console.error('Failed to patch chunk:', errBody);
      }
    }

    console.log(`expire-retainers: expired ${expiredCount} contract(s)`, expiredClients);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        expiredCount,
        expiredClients
      })
    };

  } catch (error) {
    console.error('expire-retainers error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};