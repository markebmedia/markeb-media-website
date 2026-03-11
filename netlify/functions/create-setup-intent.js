// netlify/functions/create-setup-intent.js
// Creates a Stripe SetupIntent with usage: 'off_session'
// This gets the bank's explicit permission to charge the card later
// without the customer being present — fixing the authentication_required error

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
    const { email, name } = JSON.parse(event.body);

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Email is required' })
      };
    }

    // Find or create a Stripe customer so the SetupIntent is linked to them
    // This means the payment method is attached to the customer after confirmation
    let customerId;

    const existingCustomers = await stripe.customers.list({
      email: email,
      limit: 1
    });

    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
      console.log('Found existing Stripe customer:', customerId);
    } else {
      const customer = await stripe.customers.create({
        email: email,
        name: name || '',
        metadata: {
          source: 'markeb-media-booking'
        }
      });
      customerId = customer.id;
      console.log('Created new Stripe customer:', customerId);
    }

    // Create SetupIntent with usage: 'off_session'
    // This is the key difference — it tells Stripe (and the bank) that
    // this card will be charged later without the customer present
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: {
        clientEmail: email,
        source: 'markeb-media-reserve'
      }
    });

    console.log('SetupIntent created:', setupIntent.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        clientSecret: setupIntent.client_secret,
        customerId: customerId
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