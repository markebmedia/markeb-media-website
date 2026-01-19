// netlify/functions/cancel-booking-with-payment.js

const Airtable = require('airtable');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const BOOKINGS_TABLE = 'Bookings';
const SITE_URL = 'https://markebmedia.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { bookingRef, clientEmail, cancellationFee, reason } = JSON.parse(event.body);

    // Find booking
    const records = await base(BOOKINGS_TABLE)
      .select({
        filterByFormula: `AND({Booking Ref} = '${bookingRef}', {Client Email} = '${clientEmail}')`,
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

    // Create Stripe Checkout session for cancellation fee
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: `Cancellation Fee - ${bookingRef}`,
              description: `Cancellation fee for booking ${bookingRef}`
            },
            unit_amount: Math.round(cancellationFee * 100)
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `${SITE_URL}/cancellation-success?ref=${bookingRef}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/manage-booking?ref=${bookingRef}&email=${encodeURIComponent(clientEmail)}`,
      client_reference_id: booking.id,
      metadata: {
        bookingRef: bookingRef,
        cancellationFee: cancellationFee.toString(),
        reason: reason || 'No reason provided',
        type: 'cancellation_fee'
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        checkoutUrl: session.url,
        sessionId: session.id
      })
    };

  } catch (error) {
    console.error('Cancellation payment error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};