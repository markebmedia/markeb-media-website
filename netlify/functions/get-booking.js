// netlify/functions/get-booking.js
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  console.log('=== Get Booking Function ===');
  
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

  const { ref, email } = event.queryStringParameters || {};
  
  if (!ref || !email) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Booking reference and email are required' })
    };
  }

  console.log('Looking up booking:', { ref, email });

  try {
    // Find booking by reference and email
    const records = await base('Bookings')
      .select({
        filterByFormula: `AND({Booking Reference} = '${ref}', {Client Email} = '${email}')`,
        maxRecords: 1
      })
      .firstPage();

    if (records.length === 0) {
      console.log('Booking not found');
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Booking not found' })
      };
    }

    const booking = records[0];
    const fields = booking.fields;

    console.log('Booking found:', fields['Booking Reference']);

    // Check if already cancelled
    const bookingStatus = fields['Booking Status'] || 'Booked';
    const isCancelled = bookingStatus === 'Cancelled';

    // Check if cancellation/rescheduling is allowed (24 hours before)
    const bookingDateTime = new Date(`${fields['Date']}T${fields['Time']}:00`);
    const now = new Date();
    const hoursUntilBooking = (bookingDateTime - now) / (1000 * 60 * 60);

    // Can only cancel/reschedule if not already cancelled AND more than 24 hours away
    const canCancel = !isCancelled && hoursUntilBooking > 24;
    const canReschedule = !isCancelled && hoursUntilBooking > 24;

    // Parse add-ons from JSON string to array
    let addonsArray = [];
    try {
      const addonsString = fields['Add-Ons'] || '[]';
      addonsArray = JSON.parse(addonsString);
    } catch (e) {
      console.error('Error parsing add-ons:', e);
      addonsArray = [];
    }

    // Return booking data aligned with create-booking.js
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        id: booking.id,
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
        clientName: fields['Client Name'],
        clientEmail: fields['Client Email'],
        clientPhone: fields['Client Phone'],
        clientNotes: fields['Client Notes'] || '',
        
        // ✅ NEW: Access Type fields
        accessType: fields['Access Type'] || '',
        keyPickupLocation: fields['Key Pickup Location'] || '',
        
        // Payment method details (for reserved bookings)
        stripePaymentMethodId: fields['Stripe Payment Method ID'] || '',
        cardholderName: fields['Cardholder Name'] || '',
        cardLast4: fields['Card Last 4'] || '',
        cardBrand: fields['Card Brand'] || '',
        cardExpiry: fields['Card Expiry'] || '',
        
        // Management flags
        canCancel: canCancel,
        canReschedule: canReschedule,
        hoursUntilBooking: Math.round(hoursUntilBooking),
        isCancelled: isCancelled
      })
    };

  } catch (error) {
    console.error('Error fetching booking:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to fetch booking',
        details: error.message 
      })
    };
  }
};