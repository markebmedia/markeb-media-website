// netlify/functions/send-card-update.js
// Called by the admin panel when a client needs to update their card on file.
// 1. Pulls booking details from Airtable
// 2. Creates a Stripe SetupIntent linked to the booking
// 3. Emails the client a branded link to update-card.html

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Airtable = require('airtable');
const { sendCardUpdateEmail } = require('./email-service');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  console.log('=== Send Card Update Function ===');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { bookingId } = JSON.parse(event.body);

    if (!bookingId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'bookingId is required' })
      };
    }

    // ── Step 1: Pull booking from Airtable ──────────────────────────────────
    let booking;
    try {
      booking = await base('Bookings').find(bookingId);
    } catch (err) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Booking not found' })
      };
    }

    const fields      = booking.fields;
    const clientEmail = fields['Client Email'];
    const clientName  = fields['Client Name'];
    const bookingRef  = fields['Booking Reference'];
    const service     = fields['Service'];
    const date        = fields['Date'];
    const time        = fields['Time'];

    if (!clientEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Booking has no client email' })
      };
    }

    console.log(`Sending card update link to ${clientEmail} for booking ${bookingRef}`);

    // ── Step 2: Find or create Stripe customer ──────────────────────────────
    let customerId = fields['Stripe Customer ID'];

    if (!customerId) {
      const existing = await stripe.customers.list({ email: clientEmail, limit: 1 });

      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
        console.log('Found existing Stripe customer:', customerId);
      } else {
        const customer = await stripe.customers.create({
          email: clientEmail,
          name: clientName || '',
          metadata: { source: 'markeb-media-booking' }
        });
        customerId = customer.id;
        console.log('Created new Stripe customer:', customerId);

        await base('Bookings').update(bookingId, {
          'Stripe Customer ID': customerId
        });
      }
    }

    // ── Step 3: Create SetupIntent ──────────────────────────────────────────
    // usage: 'off_session' tells Stripe this card will be charged later
    // without the customer present — this is what gets proper bank authorisation
    // including 3D Secure, matching exactly what happens during the reserve flow
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: {
        bookingId:   bookingId,
        bookingRef:  bookingRef,
        clientEmail: clientEmail,
        source:      'markeb-media-card-update'
      }
    });

    console.log('SetupIntent created:', setupIntent.id);

    // ── Step 4: Build the update link ───────────────────────────────────────
    const updateLink = `https://markebmedia.com/website/update-card?bookingId=${bookingId}`;

    // ── Step 5: Send the email via email-service ────────────────────────────
    await sendCardUpdateEmail({
      clientName,
      clientEmail,
      bookingRef,
      service,
      date,
      time,
      updateLink
    });

    console.log(`✅ Card update email sent to ${clientEmail}`);

    // ── Step 6: Log the action in Airtable ──────────────────────────────────
    try {
      await base('Bookings').update(bookingId, {
        'Card Update Requested': new Date().toISOString().split('T')[0]
      });
    } catch (logErr) {
      console.warn('Could not log Card Update Requested date (field may not exist):', logErr.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Card update link sent to ${clientEmail}`,
        bookingRef
      })
    };

  } catch (error) {
    console.error('❌ send-card-update error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to send card update link',
        details: error.message
      })
    };
  }
};