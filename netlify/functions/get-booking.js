// netlify/functions/get-booking.js

const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  // Only allow GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const { ref, email } = event.queryStringParameters || {};

  if (!ref || !email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Booking reference and email are required' })
    };
  }

  try {
    // Find booking by reference and email
    const records = await base('Bookings')
      .select({
        filterByFormula: `AND({Booking Reference} = '${ref}', {Client Email} = '${email}')`,
        maxRecords: 1
      })
      .firstPage();

    if (records.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Booking not found' })
      };
    }

    const booking = records[0];
    const fields = booking.fields;

    // Check if cancellation is allowed (24 hours before)
    const bookingDate = new Date(fields['Date']);
    const now = new Date();
    const hoursUntilBooking = (bookingDate - now) / (1000 * 60 * 60);
    const canCancel = hoursUntilBooking > 24;
    const canReschedule = hoursUntilBooking > 24;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: booking.id,
        bookingRef: fields['Booking Reference'],
        postcode: fields['Postcode'],
        propertyAddress: fields['Property Address'],
        region: fields['region'],
        mediaspecialist: fields['mediaspecialist'],
        date: fields['Date'],
        time: fields['Time'],
        service: fields['Service Name'],
        bedrooms: fields['Bedrooms'],
        totalPrice: fields['Total Price'],
        status: fields['Status'],
        paymentStatus: fields['Payment Status'],
        clientName: fields['Client Name'],
        clientEmail: fields['Client Email'],
        clientPhone: fields['Client Phone'],
        addons: fields['Add-ons'],
        canCancel: canCancel,
        canReschedule: canReschedule,
        hoursUntilBooking: Math.round(hoursUntilBooking)
      })
    };

  } catch (error) {
    console.error('Error fetching booking:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to fetch booking',
        details: error.message 
      })
    };
  }
};