// netlify/functions/get-client-bookings.js
// Returns Active Bookings + Cancelled Bookings for a specific client email.
// Filters server-side in Airtable — clients only ever receive their own data.

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const ACTIVE_TABLE    = 'Active Bookings';
const CANCELLED_TABLE = 'Cancelled Bookings';

async function fetchAllRecords(url) {
  const records = [];
  let offset = null;
  do {
    const pageUrl = offset ? `${url}&offset=${offset}` : url;
    const res = await fetch(pageUrl, {
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
  return records;
}

function mapActiveBooking(record) {
  const f = record.fields;
  return {
    id:           record.id,
    projectAddress: f['Project Address'] || 'Property booking',
    customerName:   f['Customer Name']   || '',
    serviceType:    f['Service Type']    || '',
    shootDate:      f['Shoot Date']      || null,
    status:         f['Status']          || 'Booked',
    trackingCode:   f['Tracking Code']   || '',
    deliveryLink:   f['Delivery Link']   || '',
    cancelled:      false,
  };
}

function mapCancelledBooking(record) {
  const f = record.fields;
  return {
    id:             record.id,
    projectAddress: f['Project Address'] || 'Property booking',
    customerName:   f['Customer Name']   || '',
    serviceType:    f['Service Type']    || '',
    shootDate:      f['Shoot Date']      || null,
    status:         f['Status']          || 'Cancelled',
    trackingCode:   f['Tracking Code']   || '',
    deliveryLink:   '',
    cancelled:      true,
  };
}

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

    // ── 1. Active Bookings — filtered server-side by Email Address ────
    const activeFormula = encodeURIComponent(`LOWER({Email Address}) = "${emailLower}"`);
    const activeUrl =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(ACTIVE_TABLE)}` +
      `?filterByFormula=${activeFormula}&sort[0][field]=Shoot%20Date&sort[0][direction]=desc`;

    // ── 2. Cancelled Bookings — filtered server-side by Email ─────────
    const cancelledFormula = encodeURIComponent(`LOWER({Email}) = "${emailLower}"`);
    const cancelledUrl =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(CANCELLED_TABLE)}` +
      `?filterByFormula=${cancelledFormula}&sort[0][field]=Shoot%20Date&sort[0][direction]=desc`;

    // Fetch both in parallel
    const [activeRecords, cancelledRecords] = await Promise.all([
      fetchAllRecords(activeUrl),
      fetchAllRecords(cancelledUrl),
    ]);

    const active    = activeRecords.map(mapActiveBooking);
    const cancelled = cancelledRecords.map(mapCancelledBooking);

    // Merge and sort by shoot date descending
    const all = [...active, ...cancelled].sort((a, b) => {
      const da = new Date(a.shootDate || 0);
      const db = new Date(b.shootDate || 0);
      return db - da;
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success:   true,
        bookings:  all,        // merged, sorted, all statuses
        active,                // active only if needed separately
        cancelled,             // cancelled only if needed separately
        totalActive:    active.length,
        totalCancelled: cancelled.length,
      }),
    };

  } catch (error) {
    console.error('get-client-bookings error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};