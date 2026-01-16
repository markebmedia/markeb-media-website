const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const bookingData = JSON.parse(event.body);

    // Validate required fields
    const required = ['postcode', 'propertyAddress', 'territory', 'date', 'time', 'service', 'clientName', 'clientEmail', 'clientPhone', 'totalPrice'];
    for (const field of required) {
      if (!bookingData[field]) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Missing required field: ${field}` })
        };
      }
    }

    // Generate Booking ID
    const bookingId = generateBookingId();

    // Format shoot date (combine date + time)
    const shootDateTime = `${bookingData.date}T${bookingData.time}:00`;

    // Prepare Airtable record
    const airtableRecord = {
      fields: {
        'Project Address': bookingData.propertyAddress,
        'Customer Name': bookingData.clientName,
        'Service Type': bookingData.service,
        'Shoot Date': shootDateTime,
        'Email Address': bookingData.clientEmail,
        'Phone Number': bookingData.clientPhone,
        'Status': 'Booked',
        'Booking ID': bookingId,
        // Additional fields (optional but useful)
        'Territory': bookingData.territory,
        'Photographer': bookingData.photographer || 'TBD',
        'Total Price': bookingData.totalPrice,
        'Payment Option': bookingData.paymentOption || 'reserve',
        'Bedrooms': bookingData.bedrooms || 0,
        'Notes': bookingData.clientNotes || '',
        'Created Date': new Date().toISOString()
      }
    };

    // Create record in Airtable
    const airtableResponse = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Active%20Bookings`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(airtableRecord)
      }
    );

    if (!airtableResponse.ok) {
      const error = await airtableResponse.json();
      console.error('Airtable error:', error);
      throw new Error('Failed to create Airtable record');
    }

    const airtableData = await airtableResponse.json();

    // Return success with booking reference
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        bookingId: bookingId,
        airtableRecordId: airtableData.id,
        message: 'Booking created successfully'
      })
    };

  } catch (error) {
    console.error('Error creating booking:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to create booking'
      })
    };
  }
};

// Generate unique booking ID
function generateBookingId() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `MK-${timestamp}-${random}`;
}