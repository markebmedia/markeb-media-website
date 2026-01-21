// netlify/functions/create-stripe-checkout.js
// Creates Stripe Checkout session for "Pay Now" bookings

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
    const bookingData = JSON.parse(event.body);
    
    console.log('Creating Stripe checkout for:', {
      service: bookingData.service,
      region: bookingData.region,
      mediaSpecialist: bookingData.mediaSpecialist,
      totalPrice: bookingData.totalPrice
    });

    // Validate required fields
    if (!bookingData.service || !bookingData.date || !bookingData.clientEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required booking data' })
      };
    }

    // Build line items for Stripe
    const lineItems = [];

    // Main service
    lineItems.push({
      price_data: {
        currency: 'gbp',
        product_data: {
          name: bookingData.service,
          description: `${bookingData.date} at ${bookingData.time} - ${bookingData.propertyAddress}`,
        },
        unit_amount: Math.round(bookingData.basePrice * 100), // Convert to pence
      },
      quantity: 1,
    });

    // Extra bedrooms fee
    if (bookingData.extraBedroomFee && bookingData.extraBedroomFee > 0) {
      const extraBedrooms = bookingData.bedrooms - 4;
      lineItems.push({
        price_data: {
          currency: 'gbp',
          product_data: {
            name: 'Extra Bedrooms',
            description: `${extraBedrooms} additional bedroom(s) @ £30 each`,
          },
          unit_amount: Math.round(bookingData.extraBedroomFee * 100),
        },
        quantity: 1,
      });
    }

    // Add-ons
    if (bookingData.addons && bookingData.addons.length > 0) {
      bookingData.addons.forEach(addon => {
        if (addon.price > 0) {
          lineItems.push({
            price_data: {
              currency: 'gbp',
              product_data: {
                name: addon.name,
                description: addon.description || '',
              },
              unit_amount: Math.round(addon.price * 100),
            },
            quantity: 1,
          });
        }
      });
    }

    // ✅ Determine if this is a new booking or existing booking payment
    const isExistingBooking = !!bookingData.bookingId;
    
    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.URL}/booking-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.URL}/booking.html?cancelled=true`,
      metadata: {
        // ✅ If existing booking (admin payment link), include bookingId
        ...(isExistingBooking && { 
          bookingId: bookingData.bookingId,
          bookingRef: bookingData.bookingRef 
        }),
        
        // Booking details
        postcode: bookingData.postcode,
        propertyAddress: bookingData.propertyAddress,
        region: bookingData.region,
        mediaSpecialist: bookingData.mediaSpecialist,
        date: bookingData.date,
        time: bookingData.time,
        serviceId: bookingData.serviceId,
        service: bookingData.service,
        duration: bookingData.duration.toString(),
        bedrooms: bookingData.bedrooms.toString(),
        
        // Client details
        clientName: bookingData.clientName,
        clientEmail: bookingData.clientEmail,
        clientPhone: bookingData.clientPhone,
        clientNotes: bookingData.clientNotes || '',
        
        // Add-ons
        addons: JSON.stringify(bookingData.addons || []),
        
        // Payment type flag
        paymentType: isExistingBooking ? 'existing_booking' : 'new_booking'
      },
      customer_email: bookingData.clientEmail,
    });

    console.log('✅ Stripe checkout session created:', session.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        sessionId: session.id,
        url: session.url
      })
    };

  } catch (error) {
    console.error('❌ Stripe checkout error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false,
        error: 'Failed to create checkout session',
        details: error.message 
      })
    };
  }
};