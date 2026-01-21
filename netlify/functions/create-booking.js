// netlify/functions/create-booking.js
// UPDATED: Now sets paymentStatus correctly based on payment option

exports.handler = async (event, context) => {
  console.log('=== Create Booking Function (Updated) ===');
  console.log('Method:', event.httpMethod);
  
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
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const bookingData = JSON.parse(event.body);
    
    console.log('Received booking data:', {
      postcode: bookingData.postcode,
      region: bookingData.region,
      date: bookingData.date,
      time: bookingData.time,
      service: bookingData.service,
      paymentOption: bookingData.paymentOption
    });

    // Generate booking reference
    const timestamp = Date.now();
    const bookingRef = `BK-${timestamp}`;

    // ✅ FIXED: Set payment status based on payment option
    let paymentStatus;
    let bookingStatus;
    
    if (bookingData.paymentOption === 'pay-now') {
      // This shouldn't happen in create-booking (should go through Stripe webhook)
      // But if it does, mark as Paid
      paymentStatus = 'Paid';
      bookingStatus = 'Confirmed';
    } else if (bookingData.paymentOption === 'reserve') {
      // Card on file, payment pending
      paymentStatus = 'Pending';
      bookingStatus = 'Reserved';
    } else {
      // Fallback
      paymentStatus = 'Pending';
      bookingStatus = 'Booked';
    }

    // Prepare add-ons data
    const addonsText = bookingData.addons && bookingData.addons.length > 0
      ? bookingData.addons.map(a => `${a.name} (+£${a.price.toFixed(2)})`).join('\n')
      : '';

    const addonsPrice = bookingData.addonsPrice || 0;

    // Prepare Airtable record
    const airtableRecord = {
      fields: {
        'Booking Reference': bookingRef,
        'Date': bookingData.date,
        'Time': bookingData.time,
        'Postcode': bookingData.postcode,
        'Property Address': bookingData.propertyAddress,
        'Region': bookingData.region,
        'Media Specialist': bookingData.mediaSpecialist,
        'Service': bookingData.service,
        'Service ID': bookingData.serviceId,
        'Duration (mins)': bookingData.duration,
        'Bedrooms': bookingData.bedrooms || 0,
        'Base Price': bookingData.basePrice,
        'Extra Bedroom Fee': bookingData.extraBedroomFee || 0,
        'Add-ons': addonsText,
        'Add-ons Price': addonsPrice,
        'Total Price': bookingData.totalPrice,
        'Client Name': bookingData.clientName,
        'Client Email': bookingData.clientEmail,
        'Client Phone': bookingData.clientPhone,
        'Client Notes': bookingData.clientNotes || '',
        
        // ✅ CRITICAL: Set both Booking Status AND Payment Status
        'Booking Status': bookingStatus,
        'Payment Status': paymentStatus,
        
        // ✅ Store Stripe Payment Method details (for reserved bookings)
        'Stripe Payment Method ID': bookingData.stripePaymentMethodId || '',
        'Cardholder Name': bookingData.cardholderName || '',
        'Card Last 4': bookingData.cardLast4 || '',
        'Card Brand': bookingData.cardBrand || '',
        'Card Expiry': bookingData.cardExpiry || '',
        
        // Metadata
        'Created Date': new Date().toISOString(),
      }
    };

    console.log('Creating Airtable record with payment status:', paymentStatus);

    // Create booking in Airtable
    const airtableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Bookings`;
    
    const response = await fetch(airtableUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(airtableRecord)
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Airtable error:', errorData);
      throw new Error(`Airtable API error: ${response.status}`);
    }

    const airtableResult = await response.json();
    console.log('Booking created successfully:', bookingRef);

    // Send confirmation email (if you have email setup)
    // await sendBookingConfirmationEmail(bookingData, bookingRef);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        bookingRef: bookingRef,
        recordId: airtableResult.id,
        paymentStatus: paymentStatus,
        message: paymentStatus === 'Paid' 
          ? 'Booking confirmed and paid' 
          : 'Booking reserved - payment pending'
      })
    };

  } catch (error) {
    console.error('Error creating booking:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to create booking',
        details: error.message
      })
    };
  }
};