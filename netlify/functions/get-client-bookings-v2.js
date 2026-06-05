// netlify/functions/get-client-bookings-v2.js
// Fetches all bookings for a client from the main Bookings table.
// Filters server-side by Client Email — clients only ever receive their own data.

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { userEmail } = JSON.parse(event.body || '{}');
    if (!userEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'userEmail is required' }),
      };
    }

    const emailLower = userEmail.toLowerCase().trim();
    const formula = encodeURIComponent(`LOWER({Client Email}) = "${emailLower}"`);

    const records = [];
    let offset = null;

    do {
      let url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Bookings?filterByFormula=${formula}&sort[0][field]=Date&sort[0][direction]=desc`;
      if (offset) url += `&offset=${offset}`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Airtable error: ${err}`);
      }

      const data = await res.json();
      records.push(...(data.records || []));
      offset = data.offset || null;
    } while (offset);

    const bookings = records.map(record => {
      const f = record.fields;
      const bookingStatus = f['Booking Status'] || 'Booked';
      return {
        id:                    record.id,
        bookingRef:            f['Booking Reference']        || '',
        projectAddress:        f['Property Address']         || '',
        clientName:            f['Client Name']              || '',
        serviceType:           f['Service']                  || '',
        shootDate:             f['Date']                     || null,
        bookingStatus,
        paymentStatus:         f['Payment Status']           || 'Pending',
        finalPrice:            parseFloat(f['Final Price']   || f['Total Price'] || 0),
        totalPrice:            parseFloat(f['Total Price']   || f['Final Price'] || 0),
        stripePaymentMethodId: f['Stripe Payment Method ID'] || '',
        cardLast4:             f['Card Last 4']              || null,
        cardBrand:             f['Card Brand']               || '',
        deliveryLink:          f['Delivery Link']            || '',
        cancelled:             bookingStatus === 'Cancelled',
      };
    });

    const active    = bookings.filter(b => !b.cancelled);
    const cancelled = bookings.filter(b => b.cancelled);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success:        true,
        bookings,
        active,
        cancelled,
        totalActive:    active.length,
        totalCancelled: cancelled.length,
      }),
    };

  } catch (error) {
    console.error('get-client-bookings-v2 error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};