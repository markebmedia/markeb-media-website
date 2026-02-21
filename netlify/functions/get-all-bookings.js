// netlify/functions/get-all-bookings.js
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  console.log('=== Get All Bookings Function ===');

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Optional query params for filtering
    const {
      status,       // e.g. 'Booked', 'Completed', 'Cancelled'
      region,       // e.g. 'West Yorkshire'
      dateFrom,     // e.g. '2024-01-01'
      dateTo,       // e.g. '2024-12-31'
      limit         // max records to return (defaults to all)
    } = event.queryStringParameters || {};

    console.log('Filters:', { status, region, dateFrom, dateTo, limit });

    // Build filter formula
    const filters = [];

    if (status) {
      filters.push(`{Booking Status} = '${status}'`);
    }

    if (region) {
      filters.push(`{Region} = '${region}'`);
    }

    if (dateFrom) {
      filters.push(`IS_AFTER({Date}, '${dateFrom}')`);
    }

    if (dateTo) {
      filters.push(`IS_BEFORE({Date}, '${dateTo}')`);
    }

    const filterFormula = filters.length > 0
      ? `AND(${filters.join(', ')})`
      : '';

    // Fields to retrieve - only what the map needs
    const selectOptions = {
      fields: [
        'Booking Reference',
        'Region',
        'Postcode',
        'Property Address',
        'Service',
        'Service ID',
        'Booking Status',
        'Payment Status',
        'Date',
        'Time',
        'Total Price',
        'Final Price',
        'Client Name',
        'Client Email',
        'Media Specialist',
        'Bedrooms',
        'Add-Ons',
        'Created Time'
      ],
      sort: [{ field: 'Date', direction: 'desc' }]
    };

    if (filterFormula) {
      selectOptions.filterByFormula = filterFormula;
    }

    if (limit) {
      selectOptions.maxRecords = parseInt(limit);
    }

    // Fetch all records (handles pagination automatically)
    const allRecords = [];
    await base('Bookings')
      .select(selectOptions)
      .eachPage((records, fetchNextPage) => {
        records.forEach(record => {
          allRecords.push({
            id: record.id,
            bookingRef: record.fields['Booking Reference'],
            region: record.fields['Region'] || null,
            postcode: record.fields['Postcode'] || null,
            propertyAddress: record.fields['Property Address'] || null,
            service: record.fields['Service'] || null,
            serviceId: record.fields['Service ID'] || null,
            bookingStatus: record.fields['Booking Status'] || 'Booked',
            paymentStatus: record.fields['Payment Status'] || 'Pending',
            date: record.fields['Date'] || null,
            time: record.fields['Time'] || null,
            totalPrice: record.fields['Total Price'] || 0,
            finalPrice: record.fields['Final Price'] || record.fields['Total Price'] || 0,
            clientName: record.fields['Client Name'] || null,
            clientEmail: record.fields['Client Email'] || null,
            mediaSpecialist: record.fields['Media Specialist'] || null,
            bedrooms: record.fields['Bedrooms'] || 0,
            addons: (() => {
              try {
                return JSON.parse(record.fields['Add-Ons'] || '[]');
              } catch {
                return [];
              }
            })(),
            createdTime: record.fields['Created Time'] || null
          });
        });
        fetchNextPage();
      });

    console.log(`Fetched ${allRecords.length} bookings`);

    // Build region summary for map heatmap
    const regionSummary = {};
    allRecords.forEach(booking => {
      if (!booking.region) return;

      if (!regionSummary[booking.region]) {
        regionSummary[booking.region] = {
          region: booking.region,
          total: 0,
          booked: 0,
          completed: 0,
          cancelled: 0,
          totalRevenue: 0
        };
      }

      const summary = regionSummary[booking.region];
      summary.total++;
      summary.totalRevenue += parseFloat(booking.finalPrice) || 0;

      const status = (booking.bookingStatus || '').toLowerCase();
      if (status === 'booked') summary.booked++;
      else if (status === 'completed') summary.completed++;
      else if (status === 'cancelled') summary.cancelled++;
    });

    // 30-day growth count
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentBookings = allRecords.filter(b => {
      const created = new Date(b.createdTime);
      return created >= thirtyDaysAgo;
    }).length;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        bookings: allRecords,
        regionSummary: Object.values(regionSummary).sort((a, b) => b.total - a.total),
        meta: {
          total: allRecords.length,
          recentBookings,
          filters: { status, region, dateFrom, dateTo }
        }
      })
    };

  } catch (error) {
    console.error('Error fetching all bookings:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to fetch bookings',
        details: error.message
      })
    };
  }
};