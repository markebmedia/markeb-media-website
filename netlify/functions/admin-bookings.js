// netlify/functions/admin-bookings.js
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

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
    const { 
      startDate, 
      endDate, 
      region, 
      search, 
      status,
      paymentStatus 
    } = JSON.parse(event.body);

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

    // Status filter
    if (status) {
      filters.push(`{Booking Status} = "${status}"`);
    }

    // Payment status filter
    if (paymentStatus) {
      filters.push(`{Payment Status} = "${paymentStatus}"`);
    }

    // Search filter
    if (search) {
      filters.push(`OR(
        FIND(LOWER("${search}"), LOWER({Client Name})),
        FIND(LOWER("${search}"), LOWER({Client Email})),
        FIND(LOWER("${search}"), LOWER({Property Address})),
        FIND(LOWER("${search}"), LOWER({Booking Reference}))
      )`);
    }

    if (filters.length > 0) {
      filterFormula = filters.length === 1 ? filters[0] : `AND(${filters.join(', ')})`;
    }

    console.log('Filter formula:', filterFormula);

    const records = await base('Bookings')
      .select({
        filterByFormula: filterFormula || undefined,
        sort: [{ field: 'Date', direction: 'asc' }]
      })
      .all();

    console.log(`Found ${records.length} bookings`);

    // Calculate stats
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const stats = {
      total: records.length,
      upcoming: records.filter(r => {
        const bookingDate = new Date(r.fields['Date']);
        return bookingDate >= now && r.fields['Booking Status'] === 'Booked';
      }).length,
      pending: records.filter(r => 
        r.fields['Payment Status'] === 'Pending' && 
        r.fields['Booking Status'] === 'Booked'
      ).length
    };

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
    console.error('Error fetching bookings:', error);
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