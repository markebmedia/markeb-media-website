// netlify/functions/get-stripe-payment-method.js
// Looks up a Stripe customer by email and returns their most recent pm_xxx

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { email } = JSON.parse(event.body);
    if (!email) return { statusCode: 400, headers, body: JSON.stringify({ found: false }) };

    const customers = await stripe.customers.list({ email, limit: 1 });
    if (!customers.data.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false }) };
    }

    const customer = customers.data[0];
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customer.id,
      type: 'card',
      limit: 1
    });

    if (!paymentMethods.data.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false, customerId: customer.id }) };
    }

    const pm = paymentMethods.data[0];
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        found: true,
        customerId: customer.id,
        paymentMethodId: pm.id,
        card: {
          last4: pm.card.last4,
          brand: pm.card.brand,
          expMonth: pm.card.exp_month,
          expYear: pm.card.exp_year
        }
      })
    };
  } catch (error) {
    console.error('Error fetching Stripe payment method:', error);
    return { statusCode: 200, headers, body: JSON.stringify({ found: false }) };
  }
};