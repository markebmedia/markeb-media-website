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

// Statuses that mean content is ready or complete
const DELIVERY_STATUSES = ['Ready for Delivery', 'Complete'];

// Checks the "Bulk Invoice Client" toggle on Markeb Media Users — this is
// the end-of-month client flag. EOM clients get delivery links unlocked
// immediately regardless of invoice status.
async function isEOMClientByEmail(email) {
  if (!email) return false;
  try {
    const formula = encodeURIComponent(`LOWER({Email}) = "${email.toLowerCase().trim()}"`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent('Markeb Media Users')}?filterByFormula=${formula}&maxRecords=1`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return false;
    const data = await res.json();
    const rec = data.records && data.records[0];
    return !!(rec && rec.fields && rec.fields['Bulk Invoice Client'] === true);
  } catch (err) {
    console.error('Error checking EOM/Bulk Invoice client status:', err);
    return false;
  }
}

// "Active Bookings" own Payment Status field is only a snapshot written at
// creation time — it never gets updated when admin later marks a booking
// as Paid (that only writes to the main "Bookings" table). So instead of
// trusting the stale field, we fetch live Payment Status from "Bookings"
// for this client, keyed by Booking Reference, and use that as truth.
async function fetchLivePaymentStatuses(emailLower) {
  const map = {}; // normalised Booking Reference -> live Payment Status
  try {
    const formula = encodeURIComponent(`LOWER({Client Email}) = "${emailLower}"`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent('Bookings')}?filterByFormula=${formula}`;
    const records = await fetchAllRecords(url);
    records.forEach((r) => {
      const ref = r.fields['Booking Reference'];
      if (ref) map[String(ref).trim().toLowerCase()] = r.fields['Payment Status'] || null;
    });
  } catch (err) {
    console.error('Error fetching live payment statuses from Bookings:', err);
  }
  return map;
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

    // Check EOM status once per request — applies to all bookings for this client
    const isEOMClient = await isEOMClientByEmail(emailLower);

    // Live Payment Status from the main Bookings table, keyed by Booking Reference —
    // this is the source of truth, not the stale snapshot on Active Bookings
    const livePaymentStatuses = await fetchLivePaymentStatuses(emailLower);

    // ── 1. Fetch ALL bookings for this client (primary source) ─────────
    const bookingsFormula = encodeURIComponent(
      `LOWER({Email Address}) = "${emailLower}"`
    );
    const bookingsUrl =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(BOOKINGS_TABLE)}` +
      `?filterByFormula=${bookingsFormula}&sort[0][field]=Shoot%20Date&sort[0][direction]=desc`;

    const bookingRecords = await fetchAllRecords(bookingsUrl);

    // ── 2. Fetch Client Reviews for this client ────────────────────────
    // No Opted In filter — we show review panel whenever a review record exists
    const reviewsFormula = encodeURIComponent(
      `LOWER({Client Email}) = "${emailLower}"`
    );
    const reviewsUrl =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(REVIEWS_TABLE)}` +
      `?filterByFormula=${reviewsFormula}`;

    const reviewRecords = await fetchAllRecords(reviewsUrl);

    // Build review lookup: normalised address → review record fields + id
    const reviewsByAddress = {};
    reviewRecords.forEach((record) => {
      const key = normaliseAddress(record.fields['Project Address']);
      if (key) reviewsByAddress[key] = { id: record.id, fields: record.fields };
    });

    // ── 3. Build unified booking cards ────────────────────────────────
    // Every booking becomes a card. We attach review data if a matching
    // Client Reviews record exists for that address.
    const allBookingCards = bookingRecords.map((record) => {
      const f          = record.fields;
      const addressKey = normaliseAddress(f['Project Address']);
      const review     = reviewsByAddress[addressKey] || null;
      const status     = f['Status'] || 'Booked';

      // ── PAYMENT GATE ──
      // Prefer the live status from Bookings (matched via Booking ID ->
      // Booking Reference). Fall back to the Active Bookings snapshot
      // only if no live match was found (e.g. legacy/manual records).
      const bookingRef = f['Booking ID'] || null;
      const normalisedRef = bookingRef ? String(bookingRef).trim().toLowerCase() : null;
      const livePaymentStatus = normalisedRef && Object.prototype.hasOwnProperty.call(livePaymentStatuses, normalisedRef)
        ? livePaymentStatuses[normalisedRef]
        : undefined;
      const paymentStatus = livePaymentStatus !== undefined ? livePaymentStatus : (f['Payment Status'] || null);
      const unlocked = !paymentStatus || String(paymentStatus).trim().toLowerCase() === 'paid' || isEOMClient;

      const card = {
        id:             record.id,
        projectAddress: f['Project Address']  || 'Unnamed Project',
        clientEmail:    f['Email Address']    || '',
        serviceType:    f['Service Type']     || '',
        shootDate:      f['Shoot Date']       || null,
        bookingStatus:  status,
        deliveryLink:   unlocked ? (f['Delivery Link'] || null) : null,
        trackingCode:   f['Tracking Code']    || null,
        locked:         !unlocked,
        lockReason:     !unlocked ? 'Your content is ready, but your invoice is still outstanding. Please settle your invoice to unlock your download link.' : null,
        // Needed so the locked delivery card can deep-link straight to
        // /invoice/{bookingRef} instead of just switching dashboard tabs
        bookingRef:     bookingRef || null,
        // Review panel — only populated when a Client Reviews record exists
        hasReview:      !!review,
        reviewId:       review ? review.id              : null,
        reviewStatus:   review ? (review.fields['Review Status'] || 'Pending Review') : null,
        photosLink:     review ? (review.fields['Photos Dropbox Link'] || '') : '',
        videoLink:      review ? (review.fields['Video Dropbox Link']  || '') : '',
        photosNotes:    review ? (review.fields['Photos Notes']        || '') : '',
        videoNotes:     review ? (review.fields['Video Notes']         || '') : '',
        photoCount:     review ? (review.fields['Photo Count']         || null) : null,
        videoCount:     review ? (review.fields['Video Count']         || null) : null,
      };

      return card;
    });

    // ── 4. Split into two groups ──────────────────────────────────────
    // "Your Deliveries" — status is Ready for Delivery or Complete
    const deliveries = allBookingCards.filter(c =>
      DELIVERY_STATUSES.includes(c.bookingStatus)
    );

    // "Content Review" — has a Client Reviews record AND status is NOT
    // yet delivered (i.e. we haven't sent to editors / completed yet).
    // We still show the review panel on delivery cards if a review record
    // exists, but the primary split uses booking status.
    const reviewCards = allBookingCards.filter(c =>
      c.hasReview && !DELIVERY_STATUSES.includes(c.bookingStatus)
    );

    // "In Progress" — all bookings not in delivery, for the journey tracker
    const inProgress = allBookingCards.filter(c =>
      !DELIVERY_STATUSES.includes(c.bookingStatus)
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success:     true,
        // All non-delivered bookings (journey tracker cards)
        inProgress,
        // Subset of inProgress that have a review record (raw content to approve)
        reviewCards,
        // Ready for Delivery + Complete
        deliveries,
        // Legacy keys so any other callers don't break
        projects:  reviewCards,
        delivered: deliveries,
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