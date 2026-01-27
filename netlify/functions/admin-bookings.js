// netlify/functions/admin-bookings.js
exports.handler = async (event, context) => {
  console.log('=== Admin Bookings Function ===');
  
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
    const { 
      startDate, 
      endDate, 
      region, 
      search, 
      status,
      paymentStatus 
    } = JSON.parse(event.body || '{}');

    console.log('Request params:', { startDate, endDate, region, search, status, paymentStatus });

    // Build filter formula
    let filterFormula = '';
    const filters = [];

    // Date range filter
    if (startDate && endDate) {
      filters.push(`AND({Date} >= "${startDate}", {Date} <= "${endDate}")`);
    }

    // Region filter
    if (region) {
      filters.push(`{Region} = "${region}"`);
    }

    // Booking Status filter
    if (status) {
      filters.push(`{Booking Status} = "${status}"`);
    }

    // Payment Status filter
    if (paymentStatus) {
      filters.push(`{Payment Status} = "${paymentStatus}"`);
    }

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase().replace(/"/g, '\\"');
      filters.push(`OR(
        FIND(LOWER("${searchLower}"), LOWER({Client Name})),
        FIND(LOWER("${searchLower}"), LOWER({Client Email})),
        FIND(LOWER("${searchLower}"), LOWER({Property Address})),
        FIND(LOWER("${searchLower}"), LOWER({Booking Reference}))
      )`);
    }

    if (filters.length > 0) {
      filterFormula = filters.length === 1 ? filters[0] : `AND(${filters.join(', ')})`;
    }

    console.log('Filter formula:', filterFormula);

    // Fetch from Airtable using REST API
    let airtableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Bookings?sort[0][field]=Date&sort[0][direction]=asc`;
    
    if (filterFormula) {
      airtableUrl += `&filterByFormula=${encodeURIComponent(filterFormula)}`;
    }

    console.log('Fetching from Airtable...');

    const response = await fetch(airtableUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Airtable error:', errorText);
      throw new Error(`Airtable API error: ${response.status}`);
    }

    const data = await response.json();
    const records = data.records || [];

    console.log(`✓ Found ${records.length} bookings`);

    // Calculate stats
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const stats = {
      total: records.length,
      upcoming: records.filter(r => {
        if (!r.fields['Date']) return false;
        const bookingDate = new Date(r.fields['Date']);
        // Check for "Booked", "Confirmed", or "Reserved" status
        const validStatuses = ['Booked', 'Confirmed', 'Reserved'];
        return bookingDate >= now && validStatuses.includes(r.fields['Booking Status']);
      }).length,
      pending: records.filter(r => 
        r.fields['Payment Status'] === 'Pending' && 
        (r.fields['Booking Status'] === 'Booked' || r.fields['Booking Status'] === 'Reserved')
      ).length
    };

    console.log('Stats calculated:', stats);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        bookings: records,
        stats: stats
      })
    };

  } catch (error) {
    console.error('❌ Error fetching bookings:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        details: error.stack
      })
    };
  }
};