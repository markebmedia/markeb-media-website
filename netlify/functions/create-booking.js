// netlify/functions/create-booking.js
const Airtable = require('airtable');
const { sendBookingConfirmation } = require('./email-service');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const bookingData = JSON.parse(event.body);
    
    console.log('Received booking data:', {
      region: bookingData.region,
      mediaSpecialist: bookingData.mediaSpecialist,
      postcode: bookingData.postcode
    });

    const bookingRef = `BK-${Date.now()}`;

    const addonsString = bookingData.addons && bookingData.addons.length > 0
      ? bookingData.addons.map(a => a.name).join(', ')
      : '';

    // ✅ FIX: Capitalize region for Airtable ("north" → "North")
    const capitalizedRegion = bookingData.region.charAt(0).toUpperCase() + bookingData.region.slice(1);

    console.log('Creating booking with capitalized region:', capitalizedRegion);

    // Create booking record
    const record = await base('Bookings').create([
      {
        fields: {
          'Booking Reference': bookingRef,
'Postcode': bookingData.postcode,
'Property Address': bookingData.propertyAddress,
'Region': capitalizedRegion,
'Media Specialist': bookingData.mediaSpecialist,
'Date': bookingData.date,
'Time': bookingData.time,
'Service': bookingData.serviceId,
'Service Name': bookingData.service,
'Duration (mins)': bookingData.duration,
'Bedrooms': bookingData.bedrooms || 0,
'Base Price': bookingData.basePrice,
'Extra Bedroom Fee': bookingData.extraBedroomFee || 0,
'Add-ons': addonsString,
'Add-ons Price': bookingData.addonsPrice || 0,
'Total Price': bookingData.totalPrice,
'Client Name': bookingData.clientName,
'Client Email': bookingData.clientEmail,
'Client Phone': bookingData.clientPhone,
'Client Notes': bookingData.clientNotes || '',
'Booking Status': 'Booked',  // ✅ ADD THIS LINE!
          
          // Stripe Payment Method (card on file)
          'Stripe Payment Method ID': bookingData.stripePaymentMethodId || '',
          'Cardholder Name': bookingData.cardholderName || '',
          'Card Last 4': bookingData.cardLast4 || '',
          'Card Brand': bookingData.cardBrand || '',
          'Card Expiry': bookingData.cardExpiry || '',
          
          'Status': 'Reserved - Awaiting Payment',
          'Payment Status': 'Pending',
          'Payment Method': 'Card on File',
          'Created Date': new Date().toISOString(),
          'Cancellation Allowed Until': new Date(new Date(bookingData.date).getTime() - 24 * 60 * 60 * 1000).toISOString()
        }
      }
    ]);

    console.log('✅ Booking created successfully:', record[0].id, bookingRef);

    // Send confirmation email
    try {
      await sendBookingConfirmation({
        clientName: bookingData.clientName,
        clientEmail: bookingData.clientEmail,
        bookingRef: bookingRef,
        date: bookingData.date,
        time: bookingData.time,
        service: bookingData.service,
        propertyAddress: bookingData.propertyAddress,
        mediaSpecialist: bookingData.mediaSpecialist, // ✅ FIX: Changed from Media Specialist to mediaSpecialist
        totalPrice: bookingData.totalPrice,
        duration: bookingData.duration
      });
      console.log('Confirmation email sent to:', bookingData.clientEmail);
    } catch (emailError) {
      console.error('Failed to send confirmation email:', emailError);
      // Don't fail the booking if email fails
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        bookingId: record[0].id,
        bookingRef: bookingRef,
        message: 'Booking reserved successfully'
      })
    };

  } catch (error) {
    console.error('❌ Error creating booking:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack
    });
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to create booking',
        details: error.message
      })
    };
  }
};