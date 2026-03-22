// netlify/functions/get-client-gallery.js
//
// Returns two sets of data for the Gallery section:
//
//   1. "projects"  — Client Reviews table records (opted-in, raw content for review)
//   2. "delivered" — Bookings table records where:
//                     • Client Email matches
//                     • Delivery Link is populated
//                     • Booking Status is not Cancelled
//
// The frontend renders them as two distinct card types in the same grid.

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

// ── Table names — adjust if yours differ ──────────────────────────────
const REVIEWS_TABLE  = 'Client Reviews';
const BOOKINGS_TABLE = 'Active Bookings'; // your active bookings table

// ── Helper: fetch all pages from an Airtable endpoint ────────────────
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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
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

    // ── 1. Client Reviews (raw content awaiting review) ───────────────
    const reviewsFormula = encodeURIComponent(
      `AND(LOWER({Client Email}) = "${emailLower}", {Opted In} = TRUE())`
    );

    const reviewsUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(REVIEWS_TABLE)}` +
      `?filterByFormula=${reviewsFormula}&sort[0][field]=Created At&sort[0][direction]=desc`;

    const reviewRecords = await fetchAllRecords(reviewsUrl);

    const projects = reviewRecords.map((record) => {
      const f = record.fields;
      return {
        id:               record.id,
        cardType:         'review',               // used by frontend to pick card template
        bookingId:        f['Booking ID']         || '',
        projectAddress:   f['Project Address']    || 'Unnamed Project',
        clientEmail:      f['Client Email']       || '',
        photosLink:       f['Photos Dropbox Link']|| '',
        videoLink:        f['Video Dropbox Link'] || '',
        photosNotes:      f['Photos Notes']       || '',
        videoNotes:       f['Video Notes']        || '',
        reviewStatus:     f['Review Status']      || 'Pending Review',
        submittedAt:      f['Submitted At']       || null,
        createdAt:        f['Created At']         || record.createdTime,
        shootDate:        f['Shoot Date']         || null,
        serviceType:      f['Service Type']       || '',
        photographerName: f['Photographer Name']  || '',
        photoCount:       f['Photo Count']        || null,
        videoCount:       f['Video Count']        || null,
      };
    });

    // ── 2. Delivered bookings (completed work with a delivery link) ───
    //
    // Pulls records where:
    //   • Client Email (case-insensitive) matches
    //   • Delivery Link field is not empty
    //   • Booking Status != Cancelled
    //
    // Adjust field names below to match your actual Bookings table columns.
    const bookingsFormula = encodeURIComponent(
      `AND(
        LOWER({Client Email}) = "${emailLower}",
        {Delivery Link} != "",
        {Booking Status} != "Cancelled"
      )`
    );

    const bookingsUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(BOOKINGS_TABLE)}` +
      `?filterByFormula=${bookingsFormula}&sort[0][field]=Date&sort[0][direction]=desc`;

    const bookingRecords = await fetchAllRecords(bookingsUrl);

    const delivered = bookingRecords.map((record) => {
      const f = record.fields;
      return {
        id:             record.id,
        cardType:       'delivered',              // frontend renders a simpler "download" card
        bookingId:      f['Booking ID']           || f['ID'] || record.id,
        projectAddress: f['Property Address']     || f['Project Address'] || 'Property',
        clientEmail:    f['Client Email']         || '',
        deliveryLink:   f['Delivery Link']        || '',
        serviceType:    f['Service Type']         || f['Package']         || '',
        shootDate:      f['Date']                 || f['Shoot Date']      || null,
        bookingStatus:  f['Booking Status']       || 'Completed',
        finalPrice:     f['Final Price']          || null,
        photographer:   f['Photographer']         || f['Photographer Name'] || '',
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success:   true,
        projects,          // review cards (raw content)
        delivered,         // delivered content cards (download links)
      }),
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