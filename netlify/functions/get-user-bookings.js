// netlify/functions/get-user-bookings.js
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  console.log('=== Get User Bookings Function ===');
  
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
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

  let userEmail;
  try {
    const body = JSON.parse(event.body);
    userEmail = body.userEmail;
  } catch (e) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid request body' })
    };
  }

  if (!userEmail) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'User email is required' })
    };
  }

  console.log('Fetching bookings for user:', userEmail);

  try {
    // Find all bookings for this email, sorted by date (most recent first)
    const records = await base('Bookings')
      .select({
        filterByFormula: `{Client Email} = '${userEmail}'`,
        sort: [{ field: 'Date', direction: 'desc' }],
        maxRecords: 10 // Limit to 10 most recent bookings
      })
      .firstPage();

    console.log(`Found ${records.length} bookings for ${userEmail}`);

    // Transform records into booking objects
    const bookings = records.map(record => {
      const fields = record.fields;
      
      // Parse add-ons from JSON string to array
      let addonsArray = [];
      try {
        const addonsString = fields['Add-Ons'] || '[]';
        addonsArray = JSON.parse(addonsString);
      } catch (e) {
        console.error('Error parsing add-ons:', e);
        addonsArray = [];
      }

      // Check booking status and timing
      const bookingStatus = fields['Booking Status'] || 'Booked';
      const isCancelled = bookingStatus === 'Cancelled';
      const bookingDateTime = new Date(`${fields['Date']}T${fields['Time']}:00`);
      const now = new Date();
      const hoursUntilBooking = (bookingDateTime - now) / (1000 * 60 * 60);

      return {
        id: record.id,
        bookingRef: fields['Booking Reference'],
        postcode: fields['Postcode'],
        propertyAddress: fields['Property Address'],
        region: fields['Region'],
        mediaSpecialist: fields['Media Specialist'],
        date: fields['Date'],
        time: fields['Time'],
        service: fields['Service'],
        serviceId: fields['Service ID'],
        duration: fields['Duration (mins)'],
        bedrooms: fields['Bedrooms'] || 0,
        basePrice: fields['Base Price'],
        extraBedroomFee: fields['Extra Bedroom Fee'] || 0,
        addons: addonsArray,
        addonsPrice: fields['Add-ons Price'] || 0,
        totalPrice: fields['Total Price'],
        finalPrice: fields['Final Price'] || fields['Total Price'] || 0,
        discountCode: fields['Discount Code'] || null,
        discountAmount: fields['Discount Amount'] || 0,
        priceBeforeDiscount: fields['Price Before Discount'] || 0,
        bookingStatus: bookingStatus,
        paymentStatus: fields['Payment Status'] || 'Pending',
        
        // Management flags
        canCancel: !isCancelled && hoursUntilBooking > 24,
        canReschedule: !isCancelled && hoursUntilBooking > 24,
        hoursUntilBooking: Math.round(hoursUntilBooking),
        isCancelled: isCancelled,
        isPast: hoursUntilBooking < 0
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        count: bookings.length,
        bookings: bookings
      })
    };

  } catch (error) {
    console.error('Error fetching user bookings:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false,
        error: 'Failed to fetch bookings',
        details: error.message 
      })
    };
  }
};