// netlify/functions/cancel-booking-with-payment.js
const Airtable = require('airtable');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const SITE_URL = process.env.URL || 'https://markebmedia.co.uk';

exports.handler = async (event) => {
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
    const { bookingRef, clientEmail, cancellationFee, reason } = JSON.parse(event.body);

    if (!bookingRef || !clientEmail || cancellationFee === undefined) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Booking reference, email, and cancellation fee are required' })
      };
    }

    console.log(`Processing cancellation with payment for ${bookingRef}`);

    // Find the booking
    const records = await base('Bookings')
      .select({
        filterByFormula: `AND({Booking Reference} = '${bookingRef}', {Client Email} = '${clientEmail}')`,
        maxRecords: 1
      })
      .firstPage();

    if (records.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Booking not found' })
      };
    }

    const booking = records[0];
    const fields = booking.fields;

    // Check if already cancelled
    if (fields['Booking Status'] === 'Cancelled') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Booking is already cancelled' })
      };
    }

    // Calculate expected cancellation fee (verify it matches)
    const bookingDateTime = new Date(`${fields['Date']}T${fields['Time']}:00`);
    const now = new Date();
    const hoursUntil = (bookingDateTime - now) / (1000 * 60 * 60);
    const totalPrice = fields['Total Price'];

    let expectedFee = 0;
    let feeType = '';

    if (hoursUntil < 24 && hoursUntil >= 0) {
      expectedFee = totalPrice * 0.5; // 50% fee
      feeType = '50% Late Cancellation Fee';
    } else if (hoursUntil < 0) {
      expectedFee = totalPrice; // 100% fee
      feeType = '100% Same-Day Cancellation Fee';
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'No cancellation fee required. Use free cancellation instead.',
          hoursUntil: Math.round(hoursUntil)
        })
      };
    }

    // Verify the fee matches (allow small rounding differences)
    if (Math.abs(expectedFee - cancellationFee) > 0.01) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Cancellation fee mismatch',
          expected: expectedFee,
          provided: cancellationFee
        })
      };
    }

    // Create Stripe Checkout Session for cancellation fee payment
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: `Cancellation Fee - ${fields['Service']}`, // ✅ FIXED: Was 'Service Name'
              description: `${feeType} for booking ${bookingRef}`,
            },
            unit_amount: Math.round(cancellationFee * 100), // Convert to pence
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${SITE_URL}/cancellation-success.html?ref=${bookingRef}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/manage-booking.html?ref=${bookingRef}&email=${encodeURIComponent(clientEmail)}`,
      customer_email: clientEmail,
      metadata: {
        bookingId: booking.id,
        bookingRef: bookingRef,
        cancellationType: feeType,
        cancellationReason: reason || 'No reason provided',
        originalTotalPrice: totalPrice.toString(),
        cancellationFee: cancellationFee.toString()
      }
    });

    // Store pending cancellation info in Airtable (will be completed after payment)
    await base('Bookings').update(booking.id, {
      'Cancellation Pending': true,
      'Cancellation Fee': cancellationFee,
      'Cancellation Type': feeType,
      'Cancellation Reason': reason || 'No reason provided',
      'Cancellation Session ID': session.id
    });

    console.log(`✅ Cancellation payment session created: ${session.id}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        checkoutUrl: session.url,
        sessionId: session.id,
        cancellationFee: cancellationFee,
        feeType: feeType
      })
    };

  } catch (error) {
    console.error('Error creating cancellation payment:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to process cancellation payment',
        details: error.message 
      })
    };
  }
};