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

    // ✅ Guard against stale/leftover localPlaces data reaching Stripe metadata —
    // only pass it through if Local Area Highlights was actually part of the booking
    const hasLocalAreaHighlights =
      bookingData.serviceId === 'gold-package' ||
      (bookingData.addons || []).some(a => a.id === 'local-area-highlights' || a.name === 'Local Area Highlights');

    const safeLocalPlaces = hasLocalAreaHighlights ? (bookingData.localPlaces || []) : [];

    if (!hasLocalAreaHighlights && bookingData.localPlaces && bookingData.localPlaces.length > 0) {
      console.warn('⚠️ localPlaces received without Local Area Highlights selected — discarding stale data:', bookingData.localPlaces);
    }
    
    console.log('Creating Stripe checkout for:', {
      service: bookingData.service,
      region: bookingData.region,
      mediaSpecialist: bookingData.mediaSpecialist,
      totalPrice: bookingData.totalPrice,
      discountCode: bookingData.discountCode || 'none',
      discountAmount: bookingData.discountAmount || 0,
      source: bookingData.source || 'booking_page'
    });

    // Validate required fields
    if (!bookingData.service || !bookingData.date || !bookingData.clientEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required booking data' })
      };
    }

    // ✅ CHANGE 1: Pre-generate booking ref once so success URL and metadata match
    const isExistingBooking = !!bookingData.bookingId;
    const newBookingRef = `BK-${Date.now()}`;

    // Determine redirect URLs based on source
    const isDashboard = bookingData.source === 'dashboard';
    
    // ✅ CHANGE 2: Pass ref + email directly in success URL (no race condition)
    const successUrl = isDashboard
      ? `${process.env.URL}/website/dashboard.html?view=bookings&payment=success&session_id={CHECKOUT_SESSION_ID}`
      : `${process.env.URL}/website/booking-success.html?ref=${newBookingRef}&email=${encodeURIComponent(bookingData.clientEmail)}`;
    
    const cancelUrl = isDashboard
      ? `${process.env.URL}/website/dashboard.html?view=bookings&payment=cancelled`
      : `${process.env.URL}/booking.html?cancelled=true`;

    console.log('✓ Redirect URLs:', {
      success: successUrl,
      cancel: cancelUrl
    });

    // Build line items for Stripe with discount support
    const lineItems = [];

    const hasDiscount = bookingData.discountCode && bookingData.discountAmount > 0;

    lineItems.push({
      price_data: {
        currency: 'gbp',
        product_data: {
          name: bookingData.service,
          description: `${bookingData.date} at ${bookingData.time} - ${bookingData.propertyAddress}${bookingData.discountCode ? `\n\nDiscount (${bookingData.discountCode}): -£${bookingData.discountAmount.toFixed(2)}` : ''}`,
        },
        unit_amount: Math.round(bookingData.totalPrice * 100),
      },
      quantity: 1,
    });

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        // If existing booking (admin payment link), include bookingId
        ...(isExistingBooking && { 
          bookingId: bookingData.bookingId,
          bookingRef: bookingData.bookingRef 
        }),

        // ✅ CHANGE 3: Always include bookingRef in metadata so webhook uses the same ref
        bookingRef: isExistingBooking ? bookingData.bookingRef : newBookingRef,
        
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
        
        accessType: bookingData.accessType || '',
        keyPickupLocation: bookingData.keyPickupLocation || '',
        squareFootage: bookingData.squareFootage ? bookingData.squareFootage.toString() : '',
        squareFootageFee: bookingData.squareFootageFee ? bookingData.squareFootageFee.toString() : '0',
        epcAnswers: bookingData.epcAnswers ? JSON.stringify(bookingData.epcAnswers) : '',
        localPlaces: safeLocalPlaces.length > 0
          ? JSON.stringify(safeLocalPlaces)
          : '[]',
        brandingAnswers: bookingData.brandingAnswers && Object.keys(bookingData.brandingAnswers).length > 0
          ? JSON.stringify(bookingData.brandingAnswers)
          : '{}',

        basePrice: bookingData.basePrice ? bookingData.basePrice.toString() : '0',

        // Add-ons
        addons: JSON.stringify(bookingData.addons || []),
        
        // Discount information
        discountCode: bookingData.discountCode || '',
        discountAmount: bookingData.discountAmount ? bookingData.discountAmount.toString() : '0',
        priceBeforeDiscount: bookingData.priceBeforeDiscount ? bookingData.priceBeforeDiscount.toString() : '0',
        priceExVat: bookingData.priceExVat ? bookingData.priceExVat.toString() : (bookingData.totalPrice / 1.2).toFixed(2),
        vatAmount: bookingData.vatAmount ? bookingData.vatAmount.toString() : (bookingData.totalPrice - bookingData.totalPrice / 1.2).toFixed(2),
        
        // Payment type flag
        paymentType: isExistingBooking ? 'existing_booking' : 'new_booking',
        
        // Source tracking
        source: bookingData.source || 'booking_page'
      },
      customer_email: bookingData.clientEmail,
    });

    console.log('✅ Stripe checkout session created:', session.id);
    console.log('   Line items:', lineItems.length);
    console.log('   Total amount:', bookingData.totalPrice);
    console.log('   Source:', bookingData.source || 'booking_page');

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