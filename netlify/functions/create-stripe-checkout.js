// netlify/functions/create-stripe-checkout.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const bookingData = JSON.parse(event.body);

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
    if (bookingData.extraBedroomFee > 0) {
      lineItems.push({
        price_data: {
          currency: 'gbp',
          product_data: {
            name: 'Extra Bedrooms',
            description: `${bookingData.bedrooms - 4} additional bedroom(s)`,
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
              },
              unit_amount: Math.round(addon.price * 100),
            },
            quantity: 1,
          });
        }
      });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.URL}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.URL}/booking?cancelled=true`,
      metadata: {
        postcode: bookingData.postcode,
        propertyAddress: bookingData.propertyAddress,
        territory: bookingData.territory,
        photographer: bookingData.photographer,
        date: bookingData.date,
        time: bookingData.time,
        serviceId: bookingData.serviceId,
        service: bookingData.service,
        duration: bookingData.duration.toString(),
        bedrooms: bookingData.bedrooms.toString(),
        clientName: bookingData.clientName,
        clientEmail: bookingData.clientEmail,
        clientPhone: bookingData.clientPhone,
        clientNotes: bookingData.clientNotes || '',
        addons: JSON.stringify(bookingData.addons || []),
      },
      customer_email: bookingData.clientEmail,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: session.id,
        url: session.url
      })
    };

  } catch (error) {
    console.error('Stripe checkout error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to create checkout session',
        details: error.message 
      })
    };
  }
};