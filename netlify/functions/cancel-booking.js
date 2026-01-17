// netlify/functions/cancel-booking.js

const Airtable = require('airtable');
const { sendCancellationConfirmation } = require('./email-service');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { bookingId, clientEmail, reason } = JSON.parse(event.body);

    if (!bookingId || !clientEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Verify the booking belongs to this email
    const booking = await base('Bookings').find(bookingId);

    if (booking.fields['Client Email'] !== clientEmail) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    // Check if the booking is already cancelled
    if (booking.fields['Status'] === 'Cancelled') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Booking is already cancelled' })
      };
    }

    // Calculate cancellation charge
    const bookingDate = new Date(booking.fields['Date']);
    const now = new Date();
    const hoursUntilBooking = (bookingDate - now) / (1000 * 60 * 60);

    let cancellationCharge = 0;
    let cancellationChargePercentage = 0;

    if (hoursUntilBooking < 24) {
      if (hoursUntilBooking < 0) {
        // Same day / past
        cancellationChargePercentage = 100;
      } else {
        // Within 24 hours
        cancellationChargePercentage = 50;
      }
      cancellationCharge = (booking.fields['Total Price'] * cancellationChargePercentage) / 100;
    }

    const refundAmount = booking.fields['Total Price'] - cancellationCharge;
    
    // Generate refund note
    const refundNote = cancellationChargePercentage === 0 
      ? 'Full refund will be processed within 5-7 business days'
      : cancellationChargePercentage === 50
      ? '50% cancellation fee applies. Remaining amount will be refunded within 5-7 business days'
      : 'Full cancellation fee applies. No refund available';

    // Update the booking
    const updatedRecord = await base('Bookings').update([
      {
        id: bookingId,
        fields: {
          'Status': 'Cancelled',
          'Cancellation Date': new Date().toISOString(),
          'Cancellation Reason': reason || 'Customer requested',
          'Cancellation Charge %': cancellationChargePercentage,
          'Cancellation Charge': cancellationCharge,
          'Refund Amount': refundAmount
        }
      }
    ]);

    // Send cancellation confirmation email
    try {
      await sendCancellationConfirmation({
        clientName: booking.fields['Client Name'],
        clientEmail: clientEmail,
        bookingRef: booking.fields['Booking Reference'],
        date: booking.fields['Date'],
        time: booking.fields['Time'],
        service: booking.fields['Service Name'],
        totalPrice: booking.fields['Total Price']
      }, cancellationCharge, refundAmount, refundNote);

      console.log('Cancellation confirmation sent to:', clientEmail);
    } catch (emailError) {
      console.error('Failed to send cancellation email:', emailError);
      // Don't fail the request if email fails
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Booking cancelled successfully',
        cancellationCharge: cancellationCharge,
        cancellationChargePercentage: cancellationChargePercentage,
        refundAmount: refundAmount,
        refundNote: refundNote
      })
    };

  } catch (error) {
    console.error('Error cancelling booking:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to cancel booking',
        details: error.message 
      })
    };
  }
};