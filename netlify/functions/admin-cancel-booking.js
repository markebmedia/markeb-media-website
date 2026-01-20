// netlify/functions/admin-cancel-booking.js
const Airtable = require('airtable');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendCancellationConfirmation } = require('./email-service');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { bookingId, reason, sendEmail = true } = JSON.parse(event.body);

    if (!bookingId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Booking ID is required' })
      };
    }

    console.log(`[ADMIN] Cancelling booking ${bookingId}`);

    // Fetch the booking
    const booking = await base('Bookings').find(bookingId);
    const fields = booking.fields;

    // Check if already cancelled
    if (fields['Booking Status'] === 'Cancelled') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Booking is already cancelled' })
      };
    }

    // Calculate cancellation charge based on 24-hour policy
    const bookingDateTime = new Date(`${fields['Date']}T${fields['Time']}:00`);
    const now = new Date();
    const hoursUntil = (bookingDateTime - now) / (1000 * 60 * 60);

    const totalPrice = fields['Total Price'];
    let cancellationCharge = 0;
    let cancellationChargePercentage = 0;

    // Apply 24-hour cancellation policy
    if (hoursUntil < 24 && hoursUntil >= 0) {
      // Within 24 hours - 50% fee
      cancellationCharge = totalPrice * 0.5;
      cancellationChargePercentage = 50;
    } else if (hoursUntil < 0) {
      // Same day or past - 100% fee
      cancellationCharge = totalPrice;
      cancellationChargePercentage = 100;
    }

    const refundAmount = totalPrice - cancellationCharge;
    const isPaidBooking = fields['Payment Status'] === 'Paid';
    
    let refundNote = '';
    let stripeRefundId = '';

    // Process Stripe refund for paid bookings
    if (isPaidBooking && refundAmount > 0) {
      try {
        const paymentIntentId = fields['Stripe Payment Intent ID'];
        
        if (paymentIntentId) {
          console.log(`Processing Stripe refund: £${refundAmount.toFixed(2)}`);
          
          const refund = await stripe.refunds.create({
            payment_intent: paymentIntentId,
            amount: Math.round(refundAmount * 100), // Convert to pence
            reason: 'requested_by_customer',
            metadata: {
              bookingRef: fields['Booking Reference'],
              bookingId: bookingId,
              cancelledBy: 'Admin'
            }
          });

          stripeRefundId = refund.id;
          refundNote = `A refund of £${refundAmount.toFixed(2)} will be processed to your original payment method within 5-7 business days.`;
          console.log(`✅ Stripe refund created: ${refund.id}`);
        } else {
          refundNote = `Refund of £${refundAmount.toFixed(2)} will be processed manually.`;
        }
      } catch (stripeError) {
        console.error('Stripe refund error:', stripeError);
        refundNote = `Refund of £${refundAmount.toFixed(2)} will be processed manually due to payment system error.`;
      }
    } else if (cancellationCharge === 0) {
      refundNote = fields['Payment Status'] === 'Paid' 
        ? 'A full refund will be processed to your original payment method within 5-7 business days.'
        : 'Your reservation has been released.';
    } else {
      refundNote = `A cancellation fee of £${cancellationCharge.toFixed(2)} (${cancellationChargePercentage}%) applies due to timing.`;
    }

    // Update booking status in Airtable
    await base('Bookings').update(bookingId, {
      'Booking Status': 'Cancelled',
      'Cancellation Date': new Date().toISOString().split('T')[0],
      'Cancellation Reason': reason || 'Admin cancelled',
      'Cancelled By': 'Admin',
      'Cancellation Charge %': cancellationChargePercentage,
      'Cancellation Charge': cancellationCharge,
      'Refund Amount': refundAmount,
      'Stripe Refund ID': stripeRefundId,
      'Last Modified': new Date().toISOString()
    });

    console.log(`✅ Booking ${fields['Booking Reference']} cancelled by admin`);

    // Send cancellation confirmation email (if enabled)
    if (sendEmail) {
      try {
        await sendCancellationConfirmation(
          {
            clientName: fields['Client Name'],
            clientEmail: fields['Client Email'],
            bookingRef: fields['Booking Reference'],
            date: fields['Date'],
            time: fields['Time'],
            service: fields['Service Name'],
            totalPrice: totalPrice
          },
          cancellationCharge,
          refundAmount,
          refundNote
        );
        console.log(`Cancellation email sent to ${fields['Client Email']}`);
      } catch (emailError) {
        console.error('Failed to send cancellation email:', emailError);
      }
    } else {
      console.log('Email notification skipped (admin choice)');
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: 'Booking cancelled successfully',
        cancellationCharge: cancellationCharge,
        cancellationChargePercentage: cancellationChargePercentage,
        refundAmount: refundAmount,
        refundProcessed: isPaidBooking && refundAmount > 0,
        stripeRefundId: stripeRefundId,
        refundNote: refundNote,
        emailSent: sendEmail
      })
    };

  } catch (error) {
    console.error('Error cancelling booking:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Failed to cancel booking',
        details: error.message 
      })
    };
  }
};