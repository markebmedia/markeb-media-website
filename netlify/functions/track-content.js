// netlify/functions/track-content.js
export async function handler(event) {
if (event.httpMethod !== 'POST') {
return json(405, { message: 'Method Not Allowed' });
  }

try {
const { trackingCode } = JSON.parse(event.body || '{}');
if (!trackingCode) return json(400, { message: 'trackingCode required' });

const token  = process.env.AIRTABLE_TOKEN;
const baseId = process.env.AIRTABLE_BASE_ID;
const mainTable = process.env.AIRTABLE_TABLE_ID;                  // main property table
const brandingTable = process.env.AIRTABLE_BRANDING_SESSION_TABLE_ID; // branding sessions table

if (!token || !baseId || !mainTable || !brandingTable) {
return json(500, { message: 'Server config missing (AIRTABLE_* env vars)' });
    }

const safe = String(trackingCode).trim().replace(/'/g, "\\'");
const formula = `LOWER(TRIM({Tracking Code}))='${safe.toLowerCase()}'`;

// helper to query a specific table
async function fetchTable(tableId) {
const url = `https://api.airtable.com/v0/${baseId}/${tableId}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) return null;
const data = await res.json();
return (data.records && data.records[0]) ? data.records[0].fields : null;
    }

// try main table first, fallback to branding
let f = await fetchTable(mainTable);
let source = 'main';
if (!f) {
f = await fetchTable(brandingTable);
source = 'branding';
    }

if (!f) {
return json(404, { message: 'Not found' });
    }

// ===== PAYMENT GATE =====
// The snapshot Payment Status on this table (main property table /
// branding sessions) is only written at creation time and never updated
// when admin later marks a booking Paid — so we look up the live status
// from the main "Bookings" table via Booking ID first, and only fall
// back to the local snapshot if no match is found.
const bookingRef = f['Booking ID'] || null;
const clientEmail = f['Client Email'] || f['Email Address'] || null;

let paymentStatus = f['Payment Status'] || null;
if (bookingRef) {
  const live = await fetchLiveBookingPaymentStatus(token, baseId, bookingRef);
  if (live !== undefined) paymentStatus = live;
}

let isEOMClient = false;
if (paymentStatus && String(paymentStatus).trim().toLowerCase() !== 'paid' && clientEmail) {
isEOMClient = await checkEOMClient(token, baseId, clientEmail);
}

// Fail-open only when this record type doesn't carry a Payment Status
// field at all (e.g. legacy rows) — otherwise unpaid + not-EOM = locked.
const unlocked = !paymentStatus || String(paymentStatus).trim().toLowerCase() === 'paid' || isEOMClient;

const responseData = {
status:         f['Status'] || null,
shootDate:      f['Shoot Date'] || null,
customerName:   f['Customer Name'] || null,
serviceType:    f['Service Type'] || null,
projectAddress: f['Project Address'] || null,
source,
locked: !unlocked,
deliveryLink: unlocked ? (f['Delivery Link'] || null) : null,
vimeoLink:    unlocked ? (f['Vimeo Link'] || null) : null
    };

if (!unlocked) {
responseData.lockReason = 'Your content is ready, but your invoice is still outstanding. Please settle your invoice to unlock your download link.';
}

return json(200, { record: responseData });

  } catch (e) {
return json(500, { message: 'Server error', error: String(e) });
  }
}

async function fetchLiveBookingPaymentStatus(token, baseId, bookingRef) {
  try {
    const safeRef = String(bookingRef).trim().replace(/'/g, "\\'");
    const formula = `{Booking Reference}='${safeRef}'`;
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent('Bookings')}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return undefined;
    const data = await res.json();
    const rec = data.records && data.records[0];
    return rec ? (rec.fields['Payment Status'] || null) : undefined;
  } catch {
    return undefined;
  }
}

async function checkEOMClient(token, baseId, email) {
try {
const safeEmail = String(email).trim().replace(/'/g, "\\'");
const formula = `LOWER(TRIM({Email}))='${safeEmail.toLowerCase()}'`;
const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent('Markeb Media Users')}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) return false;
const data = await res.json();
const rec = data.records && data.records[0];
return !!(rec && rec.fields && rec.fields['Bulk Invoice Client'] === true);
  } catch {
return false;
  }
}

function json(statusCode, obj) {
return {
statusCode,
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(obj)
  };
}