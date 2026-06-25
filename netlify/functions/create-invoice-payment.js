// netlify/functions/create-invoice-payment.js
// Creates a Stripe PaymentIntent for a given invoice reference
// Called by view-invoice page when client clicks Pay Now

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { invoiceNum } = JSON.parse(event.body);
    if (!invoiceNum) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing invoiceNum' }) };

    // Strip INV-MM prefix to get booking reference
    const bookingRef = invoiceNum.startsWith('INV-MM') ? invoiceNum.slice(6) : invoiceNum;

    // Look up booking
    const records = await base('Bookings')
      .select({ filterByFormula: `{Booking Reference} = "${bookingRef}"`, maxRecords: 1 })
      .firstPage();

    if (!records || records.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found' }) };
    }

    const booking = records[0];
    const f = booking.fields;

    // Guard: already paid
    if ((f['Payment Status'] || '').toLowerCase() === 'paid') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invoice already paid' }) };
    }

    const finalPrice = parseFloat(f['Final Price'] || 0);
    if (finalPrice <= 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid invoice amount' }) };
    }

    // Find or create Stripe customer
    let customerId = f['Stripe Customer ID'];
    if (!customerId) {
      const existing = await stripe.customers.list({ email: f['Client Email'], limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: f['Client Email'],
          name: f['Client Name'],
          metadata: { bookingRef: bookingRef, source: 'markeb-media-invoice' }
        });
        customerId = customer.id;
        await base('Bookings').update(booking.id, { 'Stripe Customer ID': customerId });
      }
    }

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(finalPrice * 100),
      currency: 'gbp',
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      description: `${f['Service'] || 'Service'} — ${invoiceNum}`,
      receipt_email: f['Client Email'],
      metadata: {
        invoiceNum,
        bookingRef,
        bookingId: booking.id,
        clientEmail: f['Client Email'],
        clientName: f['Client Name'],
        source: 'invoice-pay-now'
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        clientSecret: paymentIntent.client_secret,
        amount: finalPrice,
        invoiceNum,
        clientName: f['Client Name'],
        clientEmail: f['Client Email']
      })
    };

  } catch (err) {
    console.error('create-invoice-payment error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};