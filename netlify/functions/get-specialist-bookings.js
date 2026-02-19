// netlify/functions/get-specialist-bookings.js
// Returns all bookings assigned to a specific media specialist

const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const { specialist } = event.queryStringParameters || {};

  if (!specialist) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Specialist name is required' })
    };
  }

  console.log('Fetching bookings for specialist:', specialist);

  try {
    const records = await base('Bookings')
      .select({
        filterByFormula: `{Media Specialist} = '${specialist.replace(/'/g, "\\'")}'`,
        sort: [{ field: 'Date', direction: 'desc' }]
      })
      .all();

    console.log(`Found ${records.length} bookings for ${specialist}`);

    const bookings = records.map(record => {
      const fields = record.fields;

      let addonsArray = [];
      try {
        addonsArray = JSON.parse(fields['Add-Ons'] || '[]');
      } catch (e) {
        addonsArray = [];
      }

      return {
        id: record.id,
        bookingRef: fields['Booking Reference'],
        date: fields['Date'],
        time: fields['Time'],
        propertyAddress: fields['Property Address'],
        postcode: fields['Postcode'] || '',
        region: fields['Region'] || '',
        service: fields['Service'],
        serviceId: fields['Service ID'] || '',
        duration: fields['Duration (mins)'] || 0,
        bedrooms: fields['Bedrooms'] || 0,
        addons: addonsArray,
        bookingStatus: fields['Booking Status'] || 'Booked',
        clientName: fields['Client Name'],
        clientPhone: fields['Client Phone'] || '',
        clientNotes: fields['Client Notes'] || '',
        accessType: fields['Access Type'] || '',
        keyPickupLocation: fields['Key Pickup Location'] || '',
        mediaSpecialist: fields['Media Specialist']
        // Note: price fields intentionally excluded
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ bookings, total: bookings.length })
    };

  } catch (error) {
    console.error('Error fetching specialist bookings:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch bookings', details: error.message })
    };
  }
};