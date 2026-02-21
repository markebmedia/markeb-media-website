// netlify/functions/get-all-bookings.js
const Airtable = require('airtable');
const fetch = require('node-fetch');

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
    const {
      status,
      dateFrom,
      dateTo,
      limit
    } = event.queryStringParameters || {};

    console.log('Filters:', { status, dateFrom, dateTo, limit });

    // Build Airtable filter formula
    const filters = [];
    if (status) filters.push(`{Booking Status} = '${status}'`);
    if (dateFrom) filters.push(`IS_AFTER({Date}, '${dateFrom}')`);
    if (dateTo) filters.push(`IS_BEFORE({Date}, '${dateTo}')`);

    const filterFormula = filters.length > 0 ? `AND(${filters.join(', ')})` : '';

    const selectOptions = {
      fields: [
        'Booking Reference',
        'Postcode',
        'Property Address',
        'Service',
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
        'Add-Ons'
      ],
      sort: [{ field: 'Date', direction: 'desc' }]
    };

    if (filterFormula) selectOptions.filterByFormula = filterFormula;
    if (limit) selectOptions.maxRecords = parseInt(limit);

    // ── Fetch all bookings from Airtable ──
    const allRecords = [];
    await base('Bookings')
      .select(selectOptions)
      .eachPage((records, fetchNextPage) => {
        records.forEach(record => {
          allRecords.push({
            id: record.id,
            bookingRef: record.fields['Booking Reference'] || null,
            postcode: record.fields['Postcode'] || null,
            propertyAddress: record.fields['Property Address'] || null,
            service: record.fields['Service'] || null,
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
              try { return JSON.parse(record.fields['Add-Ons'] || '[]'); }
              catch { return []; }
            })(),
            createdTime: record._rawJson.createdTime || null,
            lat: null,
            lng: null
          });
        });
        fetchNextPage();
      });

    console.log(`Fetched ${allRecords.length} bookings`);

    // ── Batch geocode postcodes via postcodes.io (free, no API key) ──
    const withPostcode = allRecords.filter(b => b.postcode);
    const postcodes = [...new Set(withPostcode.map(b => b.postcode))]; // dedupe

    if (postcodes.length > 0) {
      // Split into chunks of 100 (postcodes.io limit per request)
      const chunks = [];
      for (let i = 0; i < postcodes.length; i += 100) {
        chunks.push(postcodes.slice(i, i + 100));
      }

      // coordMap: normalised postcode -> { lat, lng }
      const coordMap = {};

      for (const chunk of chunks) {
        try {
          const geoRes = await fetch('https://api.postcodes.io/postcodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postcodes: chunk })
          });

          const geoData = await geoRes.json();

          if (geoData.result) {
            geoData.result.forEach(item => {
              if (item.result) {
                const key = item.query.toUpperCase().replace(/\s+/g, '');
                coordMap[key] = {
                  lat: item.result.latitude,
                  lng: item.result.longitude
                };
              }
            });
          }
        } catch (geoErr) {
          // Non-fatal — bookings without coords just won't show on map
          console.error('Geocoding chunk failed:', geoErr.message);
        }
      }

      // Assign lat/lng back to each booking
      allRecords.forEach(booking => {
        if (!booking.postcode) return;
        const key = booking.postcode.toUpperCase().replace(/\s+/g, '');
        if (coordMap[key]) {
          booking.lat = coordMap[key].lat;
          booking.lng = coordMap[key].lng;
        }
      });

      console.log(`Geocoded ${Object.keys(coordMap).length} unique postcodes`);
    }

    // ── 30-day growth ──
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentBookings = allRecords.filter(b => {
      return b.createdTime && new Date(b.createdTime) >= thirtyDaysAgo;
    }).length;

    // ── Summary stats ──
    const total = allRecords.length;
    const confirmed = allRecords.filter(b => b.bookingStatus === 'Booked').length;
    const completed = allRecords.filter(b => b.bookingStatus === 'Completed').length;
    const cancelled = allRecords.filter(b => b.bookingStatus === 'Cancelled').length;
    const totalRevenue = allRecords.reduce((sum, b) => sum + (parseFloat(b.finalPrice) || 0), 0);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        bookings: allRecords,
        meta: {
          total,
          confirmed,
          completed,
          cancelled,
          totalRevenue: parseFloat(totalRevenue.toFixed(2)),
          recentBookings,
          geocoded: allRecords.filter(b => b.lat).length,
          filters: { status, dateFrom, dateTo }
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