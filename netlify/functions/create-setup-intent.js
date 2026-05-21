// netlify/functions/create-setup-intent.js
// Creates a Stripe SetupIntent with usage: 'off_session'
// This gets the bank's explicit permission to charge the card later
// without the customer being present — fixing the authentication_required error
// UPDATED: supports bookingId-only flow for card update page

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  console.log('=== Create Setup Intent Function ===');

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
    const { email, name, bookingId } = JSON.parse(event.body);

    // ✅ Allow either email (reserve flow) or bookingId (card update flow)
    if (!email && !bookingId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Email or bookingId is required' })
      };
    }

    // ✅ If bookingId provided, look up the booking to get the client email
    let resolvedEmail = email;
    let bookingRef = '';

    if (bookingId) {
      try {
        const booking = await base('Bookings').find(bookingId);
        resolvedEmail = booking.fields['Client Email'];
        bookingRef = booking.fields['Booking Reference'] || '';
        console.log('Resolved booking:', bookingRef, '| Email:', resolvedEmail);
      } catch (err) {
        console.error('Booking lookup failed:', err.message);
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Booking not found' })
        };
      }
    }

    if (!resolvedEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Could not resolve client email' })
      };
    }

    // Find or create a Stripe customer
    let customerId;
    const existingCustomers = await stripe.customers.list({
      email: resolvedEmail,
      limit: 1
    });

    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
      console.log('Found existing Stripe customer:', customerId);
    } else {
      const customer = await stripe.customers.create({
        email: resolvedEmail,
        name: name || '',
        metadata: { source: 'markeb-media-booking' }
      });
      customerId = customer.id;
      console.log('Created new Stripe customer:', customerId);
    }

    // Create SetupIntent with usage: 'off_session'
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: {
        clientEmail: resolvedEmail,
        source: bookingId ? 'markeb-media-card-update' : 'markeb-media-reserve',
        ...(bookingId && { bookingId }),
        ...(bookingRef && { bookingRef })
      }
    });

    console.log('SetupIntent created:', setupIntent.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        clientSecret: setupIntent.client_secret,
        customerId: customerId,
        bookingRef: bookingRef
      })
    };

  } catch (error) {
    console.error('Error creating SetupIntent:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to create setup intent',
        details: error.message
      })
    };
  }
};