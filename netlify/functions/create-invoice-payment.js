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

// Look up booking first
const bookingRecords = await base('Bookings')
      .select({ filterByFormula: `{Booking Reference} = "${bookingRef}"`, maxRecords: 1 })
      .firstPage();

if (bookingRecords && bookingRecords.length > 0) {
  // ===== BOOKING-BASED INVOICE =====
  const booking = bookingRecords[0];
  const f = booking.fields;

  if ((f['Payment Status'] || '').toLowerCase() === 'paid') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invoice already paid' }) };
  }

  const finalPrice = parseFloat(f['Final Price'] || 0);
  if (finalPrice <= 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid invoice amount' }) };
  }

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
}

// ===== FALLBACK: MANUAL INVOICE (no linked booking) =====
let invoiceRecords = await base('Invoices')
  .select({ filterByFormula: `{Invoice Number} = "${invoiceNum}"`, maxRecords: 1 })
  .firstPage();

if (!invoiceRecords || invoiceRecords.length === 0) {
  invoiceRecords = await base('Invoices')
    .select({ filterByFormula: `{Invoice Number} = "${bookingRef}"`, maxRecords: 1 })
    .firstPage();
}

if (!invoiceRecords || invoiceRecords.length === 0) {
  return { statusCode: 404, headers, body: JSON.stringify({ error: 'Invoice not found' }) };
}

const invoiceRecord = invoiceRecords[0];
const inv = invoiceRecord.fields;

if ((inv['Status'] || '').toLowerCase() === 'paid') {
  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invoice already paid' }) };
}

const manualFinalPrice = parseFloat(inv['Amount'] || 0);
if (manualFinalPrice <= 0) {
  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid invoice amount' }) };
}

const clientEmail = inv['Sent To Email'] || inv['Client Email'];
const clientName = inv['Sent To Name'] || inv['Client Name'];

let manualCustomerId = inv['Stripe Customer ID'];
if (!manualCustomerId) {
  const existing = await stripe.customers.list({ email: clientEmail, limit: 1 });
  if (existing.data.length > 0) {
    manualCustomerId = existing.data[0].id;
  } else {
    const customer = await stripe.customers.create({
      email: clientEmail,
      name: clientName,
      metadata: { invoiceNum, source: 'markeb-media-manual-invoice' }
    });
    manualCustomerId = customer.id;
  }
  try {
    await base('Invoices').update(invoiceRecord.id, { 'Stripe Customer ID': manualCustomerId });
  } catch (e) {
    console.warn('Could not save Stripe Customer ID to Invoices record (field may not exist):', e.message);
  }
}

const manualPaymentIntent = await stripe.paymentIntents.create({
  amount: Math.round(manualFinalPrice * 100),
  currency: 'gbp',
  customer: manualCustomerId,
  automatic_payment_methods: { enabled: true },
  description: `Invoice — ${invoiceNum}`,
  receipt_email: clientEmail,
  metadata: {
    invoiceNum,
    invoiceRecordId: invoiceRecord.id,
    clientEmail,
    clientName,
    source: 'invoice-pay-now-manual'
  }
});

return {
  statusCode: 200,
  headers,
  body: JSON.stringify({
    success: true,
    clientSecret: manualPaymentIntent.client_secret,
    amount: manualFinalPrice,
    invoiceNum,
    clientName,
    clientEmail
  })
};

  } catch (err) {
    console.error('create-invoice-payment error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};