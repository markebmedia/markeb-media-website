// netlify/functions/stripe-webhook.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Airtable = require('airtable');
const { sendPaymentConfirmation } = require('./email-service');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Webhook Error: ${err.message}` })
    };
  }

  // Handle the checkout.session.completed event
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    try {
      // Create booking in Airtable
      const metadata = session.metadata;
      const addons = JSON.parse(metadata.addons || '[]');

      const bookingRef = `BK-${Date.now()}`;

      const bookingRecord = await base('Bookings').create([
        {
          fields: {
            'Booking Reference': bookingRef,
            'Postcode': metadata.postcode,
            'Property Address': metadata.propertyAddress,
            'region': metadata.region,
            'Media Specialist': metadata.Media Specialist,
            'Date': metadata.date,
            'Time': metadata.time,
            'Service': metadata.serviceId,
            'Service Name': metadata.service || metadata.serviceId,
            'Duration (mins)': parseInt(metadata.duration) || 60,
            'Bedrooms': parseInt(metadata.bedrooms),
            'Client Name': metadata.clientName,
            'Client Email': metadata.clientEmail,
            'Client Phone': metadata.clientPhone,
            'Client Notes': metadata.clientNotes,
            'Status': 'Paid',
            'Payment Status': 'Paid',
            'Payment Method': 'Stripe',
            'Stripe Session ID': session.id,
            'Amount Paid': session.amount_total / 100,
            'Add-ons': addons.map(a => a.name).join(', '),
            'Total Price': session.amount_total / 100,
            'Created Date': new Date().toISOString(),
            'Cancellation Allowed Until': new Date(new Date(metadata.date).getTime() - 24 * 60 * 60 * 1000).toISOString()
          }
        }
      ]);

      console.log('Booking created:', bookingRecord[0].id);

      // Send payment confirmation email
      try {
        await sendPaymentConfirmation({
          clientName: metadata.clientName,
          clientEmail: metadata.clientEmail,
          bookingRef: bookingRef,
          date: metadata.date,
          time: metadata.time,
          service: metadata.service || metadata.serviceId,
          propertyAddress: metadata.propertyAddress,
          Media Specialist: metadata.Media Specialist,
          amountPaid: session.amount_total / 100,
          totalPrice: session.amount_total / 100,
          duration: parseInt(metadata.duration) || 60
        });

        console.log('Payment confirmation sent to:', metadata.clientEmail);
      } catch (emailError) {
        console.error('Failed to send payment confirmation:', emailError);
        // Don't fail the webhook if email fails
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, bookingId: bookingRecord[0].id })
      };

    } catch (error) {
      console.error('Error creating booking:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to create booking' })
      };
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true })
  };
};