// netlify/functions/charge-card.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Airtable = require('airtable');
const { sendPaymentConfirmation } = require('./email-service');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { bookingId } = JSON.parse(event.body);

    console.log('Charging card for booking:', bookingId);

    // Get booking from Airtable
    const booking = await base('Bookings').find(bookingId);
    const fields = booking.fields;

    // Check if already paid
    if (fields['Payment Status'] === 'Paid') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Booking already paid' })
      };
    }

    // Check if payment method exists
    if (!fields['Stripe Payment Method ID']) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No payment method on file' })
      };
    }

    console.log('Charging payment method:', fields['Stripe Payment Method ID']);

    // Charge the card using Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(fields['Total Price'] * 100), // Convert to pence
      currency: 'gbp',
      payment_method: fields['Stripe Payment Method ID'],
      customer_email: fields['Client Email'],
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      },
      description: `${fields['Service Name']} - ${fields['Property Address']}`,
      metadata: {
        bookingRef: fields['Booking Reference'],
        bookingId: bookingId
      }
    });

    console.log('✅ Payment intent created:', paymentIntent.id);

    // Update booking in Airtable
    await base('Bookings').update([
      {
        id: bookingId,
        fields: {
          'Status': 'Paid',
          'Payment Status': 'Paid',
          'Amount Paid': fields['Total Price'],
          'Stripe Payment Intent ID': paymentIntent.id,
          'Payment Date': new Date().toISOString()
        }
      }
    ]);

    console.log('✅ Booking updated in Airtable');

    // Send payment confirmation email
    try {
      await sendPaymentConfirmation({
        clientName: fields['Client Name'],
        clientEmail: fields['Client Email'],
        bookingRef: fields['Booking Reference'],
        date: fields['Date'],
        time: fields['Time'],
        service: fields['Service Name'],
        propertyAddress: fields['Property Address'],
        mediaSpecialist: fields['Media Specialist'], // ✅ FIX: Changed from Media Specialist to mediaSpecialist
        amountPaid: fields['Total Price'],
        totalPrice: fields['Total Price'],
        duration: fields['Duration (mins)'] || 60
      });
      console.log('Payment confirmation sent to:', fields['Client Email']);
    } catch (emailError) {
      console.error('Failed to send payment confirmation:', emailError);
      // Don't fail the charge if email fails
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Payment charged successfully',
        amount: fields['Total Price'],
        paymentIntentId: paymentIntent.id
      })
    };

  } catch (error) {
    console.error('❌ Error charging card:', error);
    console.error('Error details:', {
      message: error.message,
      type: error.type,
      code: error.code
    });
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to charge card',
        details: error.message
      })
    };
  }
};