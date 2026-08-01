// netlify/functions/xero-backfill-invoices-background.js
//
// ONE-TIME JOB. Run this once to push every existing invoice into Xero.
// Netlify "-background" functions run up to 15 minutes, return 202
// immediately, and log progress to the function logs (Netlify dashboard
// > Functions > xero-backfill-invoices-background > check the log stream
// while it runs).
//
// What it does, in order:
//   1. Finds every active (non-cancelled) Booking that does NOT yet have
//      a matching Invoices record, and creates one for it — mirroring
//      what recordInvoiceToAirtable() would have done, using the booking's
//      Client Name/Email as the recipient (since we don't know who these
//      historical ones actually went to).
//   2. Finds every Invoices record (old + newly created above) that
//      doesn't yet have a Xero Invoice ID, and pushes it to Xero one at a
//      time with a pause between each to stay well under Xero's rate limits.
//   3. Logs a final summary: created, pushed, skipped, failed.
//
// Trigger it with:
//   curl -X POST https://yourdomain.com/.netlify/functions/xero-backfill-invoices-background
//
// Safe to re-run — anything already synced (has a Xero Invoice ID) is
// skipped automatically, so if it times out partway through just run it
// again and it'll pick up where it left off.

const Airtable = require('airtable');
const { pushInvoiceToXero } = require('../../lib/push-invoice-to-xero');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const BOOKINGS_TABLE = 'Bookings';
const INVOICES_TABLE = 'Invoices';

const DELAY_BETWEEN_PUSHES_MS = 1500; // keeps well under Xero's per-minute rate limit

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.handler = async (event) => {
  console.log('=== Xero backfill started ===');

  let created = 0;
  let pushed = 0;
  let skipped = 0;
  let failed = 0;

  try {
    // ── Step 1: fetch all active bookings ──────────────────────────────
    const bookingRecords = [];
    await base(BOOKINGS_TABLE)
      .select({ filterByFormula: `{Booking Status} != 'Cancelled'` })
      .eachPage((records, fetchNextPage) => {
        bookingRecords.push(...records);
        fetchNextPage();
      });
    console.log(`Found ${bookingRecords.length} active bookings`);

    // ── Step 2: fetch all existing Invoices records ────────────────────
    const invoiceRecords = [];
    await base(INVOICES_TABLE)
      .select({})
      .eachPage((records, fetchNextPage) => {
        invoiceRecords.push(...records);
        fetchNextPage();
      });
    console.log(`Found ${invoiceRecords.length} existing Invoices records`);

    const bookingIdsWithInvoice = new Set(
      invoiceRecords.map((r) => r.fields['Booking ID']).filter(Boolean)
    );

    // ── Step 3: create Invoices records for bookings that don't have one ──
    const bookingsNeedingInvoice = bookingRecords.filter(
      (b) => !bookingIdsWithInvoice.has(b.id)
    );
    console.log(`${bookingsNeedingInvoice.length} bookings need an Invoices record created`);

    for (const booking of bookingsNeedingInvoice) {
      const f = booking.fields;
      const ref = f['Booking Reference'] || booking.id.slice(-6).toUpperCase();
      const isPaid = f['Payment Status'] === 'Paid';

      try {
        const newRecord = await base(INVOICES_TABLE).create({
          'Invoice Number': `INV-MM${ref}`,
          'Booking ID': booking.id,
          'Booking Reference': ref,
          'Client Name': f['Client Name'] || '',
          'Client Email': f['Client Email'] || '',
          'Sent To Name': f['Client Name'] || '',
          'Sent To Email': f['Client Email'] || '',
          'Amount': parseFloat(f['Final Price'] || 0),
          'Status': isPaid ? 'Paid' : 'Unpaid',
          'Issued Date': f['Date'] || new Date().toISOString().split('T')[0],
          'Service': f['Service'] || '',
          'Shoot Date': f['Date'] || '',
          'Billing Address': `${f['Property Address'] || ''}${f['Postcode'] ? ', ' + f['Postcode'] : ''}`,
          'Is Manual': false,
          'Notes': 'Auto-created during Xero historical backfill — client was never actually emailed this invoice',
          ...(isPaid ? { 'Paid Date': f['Date'] || new Date().toISOString().split('T')[0] } : {}),
        });
        invoiceRecords.push(newRecord);
        created++;
      } catch (err) {
        console.error(`Failed to create Invoices record for booking ${booking.id} (${ref}):`, err.message);
        failed++;
      }
    }

    console.log(`Created ${created} new Invoices records`);

    // ── Step 4: push every unsynced Invoices record to Xero, paced ────
    const toSync = invoiceRecords.filter((r) => !r.fields['Xero Invoice ID']);
    console.log(`${toSync.length} invoices need pushing to Xero`);

    for (let i = 0; i < toSync.length; i++) {
      const record = toSync[i];
      const label = record.fields['Invoice Number'] || record.id;

      try {
        const result = await pushInvoiceToXero(record.id);
        if (result.skipped) {
          skipped++;
          console.log(`[${i + 1}/${toSync.length}] ${label} — skipped (${result.reason})`);
        } else {
          pushed++;
          console.log(`[${i + 1}/${toSync.length}] ${label} — pushed, Xero ID ${result.xeroInvoiceId}`);
        }
      } catch (err) {
        failed++;
        console.error(`[${i + 1}/${toSync.length}] ${label} — FAILED: ${err.message}`);
      }

      // Pace requests — skip the delay after the very last one
      if (i < toSync.length - 1) {
        await sleep(DELAY_BETWEEN_PUSHES_MS);
      }
    }

    console.log('=== Xero backfill finished ===');
    console.log(`Summary: ${created} Invoices records created, ${pushed} pushed to Xero, ${skipped} skipped (already synced), ${failed} failed`);
  } catch (err) {
    console.error('Backfill job crashed:', err);
  }

  // Background functions' return value isn't sent anywhere useful — the
  // real output is the console.log stream above. Netlify still expects a
  // response shape though.
  return { statusCode: 202, body: 'Backfill running in background — check function logs for progress' };
};