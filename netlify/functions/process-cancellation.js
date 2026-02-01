// netlify/functions/process-cancellation.js
// UPDATED: Now moves bookings from Active Bookings to Cancelled Bookings
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

    // Find booking in Airtable
    const records = await base(BOOKINGS_TABLE)
      .select({
        filterByFormula: `{Booking Reference} = '${bookingRef}'`,
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

    // Update booking status to Cancelled
    await base(BOOKINGS_TABLE).update(booking.id, {
      'Booking Status': 'Cancelled',
      'Cancellation Date': new Date().toISOString().split('T')[0],
      'Cancellation Fee': cancellationFee,
      'Cancellation Reason': session.metadata.reason || 'Late cancellation with fee',
      'Stripe Cancellation Payment ID': session.payment_intent
    });

    console.log(`✅ Booking ${bookingRef} cancelled with paid fee`);

    // ✅ NEW: Move Active Booking to Cancelled Bookings
    try {
      // Find the Active Booking record
      const activeBookings = await base('tblRgcv7M9dUU3YuL')
        .select({
          filterByFormula: `{Booking ID} = '${bookingRef}'`,
          maxRecords: 1
        })
        .firstPage();

      if (activeBookings && activeBookings.length > 0) {
        const activeBooking = activeBookings[0];
        const activeBookingData = activeBooking.fields;
        
        // Create record in Cancelled Bookings table
        await base('Cancelled Bookings').create({
          'Project Address': activeBookingData['Project Address'],
          'Customer Name': activeBookingData['Customer Name'],
          'Service Type': activeBookingData['Service Type'],
          'Shoot Date': activeBookingData['Shoot Date'],
          'Status': 'Cancelled',
          'Email Address': activeBookingData['Email Address'],
          'Phone Number': activeBookingData['Phone Number'],
          'Booking ID': activeBookingData['Booking ID'],
          'Delivery Link': activeBookingData['Delivery Link'],
          'Region': activeBookingData['Region'],
          'Media Specialist': activeBookingData['Media Specialist'],
          'Cancellation Date': new Date().toISOString().split('T')[0],
          'Cancellation Reason': session.metadata.reason || 'Late cancellation with fee'
        });
        
        console.log(`✓ Booking moved to Cancelled Bookings table`);
        
        // Delete from Active Bookings table
        await base('tblRgcv7M9dUU3YuL').destroy(activeBooking.id);
        console.log(`✓ Booking removed from Active Bookings table`);
        
      } else {
        console.log(`⚠️ No Active Booking found for ${bookingRef}`);
      }
    } catch (activeBookingError) {
      console.error('Error moving Active Booking to Cancelled:', activeBookingError);
      // Don't fail the cancellation if Active Booking move fails
    }

    // Send cancellation confirmation email
    const bookingData = {
      bookingRef: booking.fields['Booking Reference'],
      clientName: booking.fields['Client Name'],
      clientEmail: booking.fields['Client Email'],
      date: booking.fields['Date'],
      time: booking.fields['Time'],
      service: booking.fields['Service'],
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