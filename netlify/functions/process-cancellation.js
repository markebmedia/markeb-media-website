// netlify/functions/process-cancellation.js
const Airtable = require('airtable');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendCancellationConfirmation } = require('./email-service');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const BOOKINGS_TABLE = 'Bookings';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { bookingRef, sessionId } = JSON.parse(event.body);

    if (!bookingRef || !sessionId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required parameters' })
      };
    }

    // Verify Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status !== 'paid') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Payment not completed' })
      };
    }

    // ✅ FIXED: Find booking in Airtable using correct field name
    const records = await base(BOOKINGS_TABLE)
      .select({
        filterByFormula: `{Booking Reference} = '${bookingRef}'`, // ✅ Was 'Booking Ref'
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
    const cancellationFee = parseFloat(session.metadata.cancellationFee || 0);
    const totalPrice = parseFloat(booking.fields['Total Price'] || 0);
    const refundAmount = totalPrice - cancellationFee;

    // ✅ FIXED: Update booking status to Cancelled using correct field name
    await base(BOOKINGS_TABLE).update(booking.id, {
      'Booking Status': 'Cancelled', // ✅ Was 'Status'
      'Cancellation Date': new Date().toISOString().split('T')[0],
      'Cancellation Fee': cancellationFee,
      'Cancellation Reason': session.metadata.reason || 'Late cancellation with fee',
      'Stripe Cancellation Payment ID': session.payment_intent
    });

    // Send cancellation confirmation email
    const bookingData = {
      bookingRef: booking.fields['Booking Reference'], // ✅ Was 'Booking Ref'
      clientName: booking.fields['Client Name'],
      clientEmail: booking.fields['Client Email'],
      date: booking.fields['Date'],
      time: booking.fields['Time'],
      service: booking.fields['Service'], // ✅ This was already correct
      totalPrice: totalPrice
    };

    const refundNote = cancellationFee === totalPrice
      ? 'Full cancellation fee applied due to same-day cancellation.'
      : 'A 50% cancellation fee has been applied as per our cancellation policy.';

    await sendCancellationConfirmation(
      bookingData,
      cancellationFee,
      refundAmount,
      refundNote
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        bookingRef: bookingData.bookingRef,
        clientEmail: bookingData.clientEmail,
        cancellationFee: cancellationFee,
        refundAmount: refundAmount
      })
    };

  } catch (error) {
    console.error('Process cancellation error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};