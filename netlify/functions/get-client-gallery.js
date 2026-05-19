// netlify/functions/get-client-gallery.js

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const REVIEWS_TABLE  = 'Client Reviews';
const BOOKINGS_TABLE = 'Active Bookings';

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

function normaliseAddress(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'userEmail is required' }) };
    }

    const emailLower = userEmail.toLowerCase().trim();

    // ── 1. Client Reviews ─────────────────────────────────────────────
    const reviewsFormula = encodeURIComponent(
      `AND(LOWER({Client Email}) = "${emailLower}", {Opted In} = TRUE())`
    );
    const reviewsUrl =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(REVIEWS_TABLE)}` +
      `?filterByFormula=${reviewsFormula}`;

    const reviewRecords = await fetchAllRecords(reviewsUrl);

    // ── 2. ALL Active Bookings for this email ─────────────────────────
    const bookingsFormula = encodeURIComponent(
      `LOWER({Email Address}) = "${emailLower}"`
    );
    const bookingsUrl =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(BOOKINGS_TABLE)}` +
      `?filterByFormula=${bookingsFormula}&sort[0][field]=Shoot Date&sort[0][direction]=desc`;

    const bookingRecords = await fetchAllRecords(bookingsUrl);

    // Build lookup map: normalisedAddress → booking fields
    const bookingsByAddress = {};
    bookingRecords.forEach((record) => {
      const f = record.fields;
      const key = normaliseAddress(f['Project Address']);
      if (key) bookingsByAddress[key] = f;
    });

    // ── 3. Enrich review cards with booking status ────────────────────
    const projects = reviewRecords.map((record) => {
      const f = record.fields;
      const addressKey = normaliseAddress(f['Project Address']);
      const booking = bookingsByAddress[addressKey] || {};

      return {
        id:               record.id,
        cardType:         'review',
        projectAddress:   f['Project Address']     || 'Unnamed Project',
        clientEmail:      f['Client Email']        || '',
        photosLink:       f['Photos Dropbox Link'] || '',
        videoLink:        f['Video Dropbox Link']  || '',
        photosNotes:      f['Photos Notes']        || '',
        videoNotes:       f['Video Notes']         || '',
        reviewStatus:     f['Review Status']       || 'Pending Review',
        submittedAt:      f['Submitted At']        || null,
        createdAt:        record.createdTime,
        shootDate:        f['Shoot Date']          || null,
        serviceType:      f['Service Type']        || '',
        photographerName: f['Photographer Name']   || '',
        photoCount:       f['Photo Count']         || null,
        videoCount:       f['Video Count']         || null,
        bookingStatus:    booking['Status']        || null,
        deliveryLink:     booking['Delivery Link'] || null,
      };
    });

    // ── 4. Delivered cards — bookings with delivery link not in review list ──
    const reviewAddressKeys = new Set(projects.map(p => normaliseAddress(p.projectAddress)));

    const delivered = bookingRecords
      .filter((record) => {
        const f = record.fields;
        return (
          f['Delivery Link'] &&
          f['Status'] === 'Ready for Delivery' &&
          !reviewAddressKeys.has(normaliseAddress(f['Project Address']))
        );
      })
      .map((record) => {
        const f = record.fields;
        return {
          id:             record.id,
          cardType:       'delivered',
          projectAddress: f['Project Address'] || 'Property',
          clientEmail:    f['Email Address']   || '',
          deliveryLink:   f['Delivery Link']   || '',
          serviceType:    f['Service Type']    || '',
          shootDate:      f['Shoot Date']      || null,
          bookingStatus:  f['Status']          || 'Ready for Delivery',
        };
      });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, projects, delivered }),
    };

  } catch (error) {
    console.error('get-client-gallery error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};