// netlify/functions/invoice-payment-webhook.js
// Handles Stripe webhook: payment_intent.succeeded
// Marks Airtable Invoices + Bookings as Paid, sends confirmation email

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Airtable = require('airtable');
const { Resend } = require('resend');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const resend = new Resend(process.env.RESEND_API_KEY);

const WEBHOOK_SECRET = process.env.STRIPE_INVOICE_WEBHOOK_SECRET;
const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const BCC_EMAIL = 'commercial@markebmedia.com';
const LOGO_URL = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Verify Stripe signature
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Only handle payment_intent.succeeded
  if (stripeEvent.type !== 'payment_intent.succeeded') {
    return { statusCode: 200, body: JSON.stringify({ received: true, ignored: true }) };
  }

  const paymentIntent = stripeEvent.data.object;
  const metadata = paymentIntent.metadata || {};

  // Only process invoice payments (not card-on-file charges from charge-card.js)
  const validSources = ['invoice-pay-now', 'invoice-pay-now-manual'];
  if (!validSources.includes(metadata.source)) {
    console.log('Skipping — not an invoice-pay-now payment');
    return { statusCode: 200, body: JSON.stringify({ received: true, ignored: true }) };
  }

  const { invoiceNum, bookingRef, bookingId } = metadata;

    // Use Sent To Name/Email from Invoices table, fall back to metadata
    const invoiceRecordCheck = await base('Invoices')
      .select({ filterByFormula: `{Invoice Number} = "${invoiceNum}"`, maxRecords: 1 })
      .firstPage();

    const invoiceFields = invoiceRecordCheck?.[0]?.fields || {};
    const clientEmail = invoiceFields['Sent To Email'] || metadata.clientEmail;
    const clientName  = invoiceFields['Sent To Name']  || metadata.clientName;
  const amountPaid = paymentIntent.amount / 100;

  console.log(`Processing invoice payment: ${invoiceNum} — £${amountPaid} — ${clientEmail}`);

  // If the shoot is already at "Ready for Delivery" (or Complete) in Active
  // Bookings, and payment has just cleared, pull the actual delivery/vimeo
  // link so the payment confirmation email can hand it straight over —
  // rather than the client having to separately check their dashboard.
  async function fetchDeliveryInfoIfReady(bookingReference) {
    if (!bookingReference) return null;
    try {
      const safeRef = String(bookingReference).trim().toLowerCase();
      const records = await base('Active Bookings')
        .select({
          filterByFormula: `LOWER(TRIM({Booking ID}))='${safeRef.replace(/'/g, "\\'")}'`,
          maxRecords: 1
        })
        .firstPage();

      const rec = records && records[0];
      if (!rec) return null;

      const status = rec.fields['Status'];
      const isReady = status === 'Ready for Delivery' || status === 'Complete';
      if (!isReady) return null;

      const deliveryLink = rec.fields['Delivery Link'] || null;
      const vimeoLink = rec.fields['Vimeo Link'] || null;
      if (!deliveryLink && !vimeoLink) return null;

      return { deliveryLink, vimeoLink, trackingCode: rec.fields['Tracking Code'] || null };
    } catch (err) {
      console.warn('Could not check Active Bookings delivery status (non-blocking):', err.message);
      return null;
    }
  }

  // Active Bookings keeps its own Payment Status snapshot that never
  // auto-syncs from Bookings — same fix already applied in admin.html's
  // markAsPaid() and charge-card.js. Without this, a booking paid via
  // an online invoice link would show Paid in Bookings but stay stale
  // (Pending) in Active Bookings, silently keeping content locked.
  async function syncActiveBookingPaymentStatus(bookingReference, status) {
    if (!bookingReference) return;
    try {
      const safeRef = String(bookingReference).trim().toLowerCase();
      const records = await base('Active Bookings')
        .select({
          filterByFormula: `LOWER(TRIM({Booking ID}))='${safeRef.replace(/'/g, "\\'")}'`,
          maxRecords: 1
        })
        .firstPage();
      if (records && records[0]) {
        await base('Active Bookings').update(records[0].id, { 'Payment Status': status });
        console.log(`✅ Active Bookings synced to "${status}" for ${bookingReference}`);
      } else {
        console.warn(`⚠️ No matching Active Bookings record for "${bookingReference}" — snapshot not synced`);
      }
    } catch (syncErr) {
      console.warn('Active Bookings sync failed (non-blocking):', syncErr.message);
    }
  }

  try {
    // ── 1. Update Booking to Paid ────────────────────────────────────────────
    let deliveryInfo = null; // populated below if content is already sitting ready

    if (bookingId) {
      const paidBooking = await base('Bookings').update(bookingId, {
        'Payment Status': 'Paid',
        'Booking Status': 'Confirmed',
        'Payment Date': new Date().toISOString(),
        'Amount Paid': amountPaid,
        'Price Ex VAT': parseFloat((amountPaid / 1.2).toFixed(2)),
        'VAT Amount': parseFloat((amountPaid - amountPaid / 1.2).toFixed(2)),
        'Stripe Payment Intent ID': paymentIntent.id
      });
      console.log('✅ Booking marked as Paid:', bookingId);
      const resolvedRef = paidBooking.fields['Booking Reference'] || bookingRef;
      await syncActiveBookingPaymentStatus(resolvedRef, 'Paid');

      // Check whether content is already sitting ready — if so, unlock and
      // hand the client the actual download link in the same email rather
      // than making them dig for it separately once payment clears.
      deliveryInfo = await fetchDeliveryInfoIfReady(resolvedRef);
    }

    // ── 2. Update Invoices table to Paid ────────────────────────────────────
    const invoiceRecords = await base('Invoices')
      .select({ filterByFormula: `{Invoice Number} = "${invoiceNum}"`, maxRecords: 1 })
      .firstPage();

    if (invoiceRecords && invoiceRecords.length > 0) {
      const paidInvoiceRecord = invoiceRecords[0];
      await base('Invoices').update(paidInvoiceRecord.id, {
        'Status': 'Paid',
        'Paid Date': new Date().toISOString().split('T')[0],
        'Auto Chase Sent': true // prevent any pending chase from firing
      });
      console.log('✅ Invoice record marked as Paid:', invoiceNum);

      // ── 2b. Cascade to linked invoices if this is a BULK invoice wrapper ──
      // Mirrors admin.html's markBulkInvoicePaid() — but that only runs when
      // an admin manually clicks "Mark Paid". This webhook is the ACTUAL
      // online payment path, and previously never cascaded at all: a client
      // paying a bulk invoice online would settle the wrapper but leave every
      // individual shoot's Invoices record — and its underlying Booking, and
      // THAT booking's Active Bookings snapshot — stuck Unpaid.
      const includedInvoiceIds = paidInvoiceRecord.fields['Included Invoices'] || [];
      if (paidInvoiceRecord.fields['Is Bulk'] && includedInvoiceIds.length > 0) {
        console.log(`Cascading payment to ${includedInvoiceIds.length} linked invoice(s)...`);
        for (const includedId of includedInvoiceIds) {
          try {
            const includedRecord = await base('Invoices').find(includedId);
            await base('Invoices').update(includedId, {
              'Status': 'Paid',
              'Paid Date': new Date().toISOString().split('T')[0]
            });

            const linkedBookingId = includedRecord.fields['Booking ID'];
            if (linkedBookingId) {
              const linkedBooking = await base('Bookings').update(linkedBookingId, {
                'Payment Status': 'Paid',
                'Booking Status': 'Confirmed',
                'Payment Date': new Date().toISOString()
              });
              await syncActiveBookingPaymentStatus(
                linkedBooking.fields['Booking Reference'] || includedRecord.fields['Booking Reference'],
                'Paid'
              );
            }
            console.log(`✅ Cascaded paid status to linked invoice ${includedId}`);
          } catch (cascadeErr) {
            console.error(`⚠️ Failed to cascade payment to linked invoice ${includedId}:`, cascadeErr.message);
          }
        }
      }
    } else {
      // Invoice record doesn't exist yet — create it as Paid
      await base('Invoices').create({
        'Invoice Number': invoiceNum,
        'Booking ID': bookingId || '',
        'Booking Reference': bookingRef || '',
        'Client Name': clientName || '',
        'Client Email': clientEmail || '',
        'Amount': amountPaid,
        'Status': 'Paid',
        'Issued Date': new Date().toISOString().split('T')[0],
        'Sent Date': new Date().toISOString().split('T')[0],
        'Paid Date': new Date().toISOString().split('T')[0],
        'Auto Chase Sent': true
      });
      console.log('✅ Invoice record created as Paid:', invoiceNum);
    }

    // ── 3. Fetch booking details for email ──────────────────────────────────
    let bookingFields = {};
    if (bookingId) {
      const bookingRecord = await base('Bookings').find(bookingId);
      bookingFields = bookingRecord.fields;
    }

    const service = bookingFields['Service'] || '';
    const date = bookingFields['Date'] || '';
    const time = bookingFields['Time'] || '';
    const address = bookingFields['Property Address'] || '';
    const postcode = bookingFields['Postcode'] || '';
    const ref = bookingFields['Booking Reference'] || bookingRef || '';

    // The actual client on the job — separate from whoever paid the invoice
    // (clientEmail/clientName below, which come from Sent To Email/Name on
    // the invoice and could be a vendor, solicitor, or other third party).
    // Only treated as a distinct recipient if their email actually differs
    // from the payer's — clients who pay for themselves get no second email.
    const actualClientEmail = bookingFields['Client Email'] || '';
    const actualClientName = bookingFields['Client Name'] || clientName;

    const payerIsClient = !!(
      actualClientEmail &&
      clientEmail &&
      actualClientEmail.trim().toLowerCase() === clientEmail.trim().toLowerCase()
    );

    let shootDate = '';
    if (date) {
      const [y, m, d2] = date.split('-').map(Number);
      shootDate = new Date(y, m - 1, d2).toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
    }

    const exVAT = parseFloat((amountPaid / 1.2).toFixed(2));
    const vatAmt = parseFloat((amountPaid - exVAT).toFixed(2));

    // ── 4. Send paid confirmation email ─────────────────────────────────────
    const emailHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Received — ${invoiceNum}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #3F4D1B; background-color: #f7ead5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background-color: #FDF3E2; }
    .header { background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%); padding: 40px 20px; text-align: center; }
    .header img { max-width: 180px; width: 100%; height: auto; margin-bottom: 16px; }
    .header h1 { color: #FDF3E2; margin: 0; font-size: 26px; font-weight: 700; }
    .header-accent { width: 40px; height: 3px; background: #B46100; margin: 14px auto 0; border-radius: 2px; }
    .paid-banner { background: #10b981; padding: 20px; text-align: center; }
    .paid-banner .icon { font-size: 36px; display: block; margin-bottom: 8px; }
    .paid-banner h2 { color: #fff; margin: 0; font-size: 20px; font-weight: 700; }
    .content { padding: 32px 24px; }
    .content p { color: #3F4D1B; margin: 0 0 14px; font-size: 15px; }
    .amount-box { background: #f0fdf4; border: 2px solid #bbf7d0; border-radius: 12px; padding: 20px; margin: 20px 0; text-align: center; }
    .amount-box .label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #065f46; margin-bottom: 6px; }
    .amount-box .amount { font-size: 36px; font-weight: 700; color: #065f46; font-family: monospace; }
    .detail-box { background: #f7ead5; border: 2px solid #e8d9be; border-radius: 12px; padding: 20px; margin: 20px 0; }
    .detail-box h3 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7c2e; margin: 0 0 14px; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e8d9be; font-size: 14px; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #6b4f2a; }
    .detail-value { color: #3F4D1B; font-weight: 600; text-align: right; }
    .vat-box { background: #f0e8d5; border: 1.5px solid #e8d5b5; border-radius: 10px; padding: 14px 16px; margin: 16px 0; }
    .vat-row { display: flex; justify-content: space-between; font-size: 13px; color: #6b4f2a; padding: 3px 0; }
    .vat-row.total { font-weight: 700; color: #3F4D1B; border-top: 1.5px solid #d4b896; padding-top: 8px; margin-top: 6px; }
    .invoice-link { display: block; text-align: center; margin: 24px 0; }
    .invoice-link a { display: inline-block; background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%); color: #FDF3E2; padding: 13px 28px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 14px; }
    .footer { background-color: #3F4D1B; padding: 24px 20px; text-align: center; color: rgba(253,243,226,0.7); font-size: 13px; }
    .footer strong { color: #FDF3E2; }
    .footer a { color: #B46100; text-decoration: none; }
    .footer-divider { width: 32px; height: 2px; background: #B46100; margin: 14px auto; border-radius: 1px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Markeb Media">
      <h1>Markeb Media</h1>
      <div class="header-accent"></div>
    </div>

    <div class="paid-banner">
      <span class="icon">✅</span>
      <h2>Payment Received</h2>
    </div>

    <div class="content">
      <p>Hi <strong>${clientName}</strong>,</p>
      <p>Your payment has been successfully received. Your invoice is now settled — thank you.</p>

      <div class="amount-box">
        <div class="label">Amount Paid</div>
        <div class="amount">£${amountPaid.toFixed(2)}</div>
      </div>

      <div class="detail-box">
        <h3>Invoice & Booking Details</h3>
        <div class="detail-row">
          <span class="detail-label">Invoice number</span>
          <span class="detail-value" style="font-family:monospace;">${invoiceNum}</span>
        </div>
        ${ref ? `<div class="detail-row">
          <span class="detail-label">Booking reference</span>
          <span class="detail-value" style="font-family:monospace;">${ref}</span>
        </div>` : ''}
        ${service ? `<div class="detail-row">
          <span class="detail-label">Service</span>
          <span class="detail-value">${service}</span>
        </div>` : ''}
        ${shootDate ? `<div class="detail-row">
          <span class="detail-label">Shoot date</span>
          <span class="detail-value">${shootDate}${time ? ' at ' + time : ''}</span>
        </div>` : ''}
        ${address ? `<div class="detail-row">
          <span class="detail-label">Property</span>
          <span class="detail-value">${address}${postcode ? ', ' + postcode : ''}</span>
        </div>` : ''}
        <div class="detail-row">
          <span class="detail-label">Status</span>
          <span class="detail-value" style="color:#10b981;">✅ Paid</span>
        </div>
      </div>

      <div class="vat-box">
        <div class="vat-row"><span>Subtotal (ex VAT)</span><span style="font-family:monospace;">£${exVAT.toFixed(2)}</span></div>
        <div class="vat-row"><span>VAT @ 20%</span><span style="font-family:monospace;">£${vatAmt.toFixed(2)}</span></div>
        <div class="vat-row total"><span>Total paid</span><span style="font-family:monospace;color:#B46100;">£${amountPaid.toFixed(2)}</span></div>
      </div>

      ${deliveryInfo && payerIsClient ? `
      <div class="amount-box" style="background:#ecfdf5;border-color:#6ee7b7;">
        <div class="label" style="color:#065f46;">🎉 Your Content is Ready!</div>
        <div style="font-size:14px;color:#065f46;margin-top:8px;line-height:1.7;">
          ${deliveryInfo.vimeoLink ? `<a href="${deliveryInfo.vimeoLink}" style="color:#065f46;font-weight:700;word-break:break-all;">🎬 Watch your video</a><br>` : ''}
          ${deliveryInfo.deliveryLink ? `<a href="${deliveryInfo.deliveryLink}" style="color:#065f46;font-weight:700;word-break:break-all;">📥 Download your files</a>` : ''}
        </div>
      </div>
      ` : ''}
      ${deliveryInfo && !payerIsClient ? `
      <p style="font-size:14px;color:#6b4f2a;">The client on this booking has been notified separately that their content is now available to view.</p>
      ` : ''}

      <div class="invoice-link">
        <a href="https://markebmedia.com/invoice/${invoiceNum}">View & Print Paid Invoice</a>
      </div>

      <p>If you have any questions, reply to this email or contact us at <a href="mailto:commercial@markebmedia.com" style="color:#B46100;">commercial@markebmedia.com</a>.</p>
      <p>Thank you for choosing Markeb Media — we look forward to the shoot!</p>
      <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
    </div>

    <div class="footer">
      <strong>Markeb Media Ltd</strong>
      <div class="footer-divider"></div>
      <p style="margin:0 0 6px;">Spaces Pennine 5, 20-22 Hawley Street, Sheffield, S1 2EA</p>
      <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
      <p style="margin-top:12px;font-size:12px;color:rgba(253,243,226,0.5);">Company No. 15919272 &nbsp;·&nbsp; VAT No. 498 4447 31</p>
    </div>
  </div>
</body>
</html>`;

    await resend.emails.send({
      from: FROM_EMAIL,
      to: clientEmail,
      bcc: BCC_EMAIL,
      subject: `✅ Payment Received — Invoice ${invoiceNum} — Markeb Media`,
      html: emailHtml
    });

    console.log('✅ Payment confirmation email sent to', clientEmail);

    // ── 5. Only if a DIFFERENT client email was detected: notify the client ──
    // ──    directly that their content is ready. Skipped entirely when the ──
    // ──    client paid for themselves (payerIsClient === true).            ──
    if (deliveryInfo && actualClientEmail && !payerIsClient) {
      const contentReadyHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Content is Ready — ${ref || invoiceNum}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #3F4D1B; background-color: #f7ead5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background-color: #FDF3E2; }
    .header { background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%); padding: 40px 20px; text-align: center; }
    .header img { max-width: 180px; width: 100%; height: auto; margin-bottom: 16px; }
    .header h1 { color: #FDF3E2; margin: 0; font-size: 26px; font-weight: 700; }
    .header-accent { width: 40px; height: 3px; background: #B46100; margin: 14px auto 0; border-radius: 2px; }
    .ready-banner { background: #10b981; padding: 20px; text-align: center; }
    .ready-banner .icon { font-size: 36px; display: block; margin-bottom: 8px; }
    .ready-banner h2 { color: #fff; margin: 0; font-size: 20px; font-weight: 700; }
    .content { padding: 32px 24px; }
    .content p { color: #3F4D1B; margin: 0 0 14px; font-size: 15px; }
    .detail-box { background: #f7ead5; border: 2px solid #e8d9be; border-radius: 12px; padding: 20px; margin: 20px 0; }
    .detail-box h3 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7c2e; margin: 0 0 14px; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e8d9be; font-size: 14px; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #6b4f2a; }
    .detail-value { color: #3F4D1B; font-weight: 600; text-align: right; }
    .links-box { background: #ecfdf5; border: 2px solid #6ee7b7; border-radius: 12px; padding: 20px; margin: 20px 0; text-align: center; }
    .links-box .label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #065f46; margin-bottom: 10px; }
    .links-box a { display: block; color: #065f46; font-weight: 700; font-size: 15px; word-break: break-all; margin: 6px 0; }
    .footer { background-color: #3F4D1B; padding: 24px 20px; text-align: center; color: rgba(253,243,226,0.7); font-size: 13px; }
    .footer strong { color: #FDF3E2; }
    .footer a { color: #B46100; text-decoration: none; }
    .footer-divider { width: 32px; height: 2px; background: #B46100; margin: 14px auto; border-radius: 1px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Markeb Media">
      <h1>Markeb Media</h1>
      <div class="header-accent"></div>
    </div>

    <div class="ready-banner">
      <span class="icon">🎉</span>
      <h2>Your Content is Ready</h2>
    </div>

    <div class="content">
      <p>Hi <strong>${actualClientName || 'there'}</strong>,</p>
      <p>Payment for your shoot has now been confirmed, and your content is ready to view and download.</p>

      <div class="detail-box">
        <h3>Booking Details</h3>
        ${ref ? `<div class="detail-row">
          <span class="detail-label">Booking reference</span>
          <span class="detail-value" style="font-family:monospace;">${ref}</span>
        </div>` : ''}
        ${service ? `<div class="detail-row">
          <span class="detail-label">Service</span>
          <span class="detail-value">${service}</span>
        </div>` : ''}
        ${address ? `<div class="detail-row">
          <span class="detail-label">Property</span>
          <span class="detail-value">${address}${postcode ? ', ' + postcode : ''}</span>
        </div>` : ''}
      </div>

      <div class="links-box">
        <div class="label">Access Your Content</div>
        ${deliveryInfo.vimeoLink ? `<a href="${deliveryInfo.vimeoLink}">🎬 Watch your video</a>` : ''}
        ${deliveryInfo.deliveryLink ? `<a href="${deliveryInfo.deliveryLink}">📥 Download your files</a>` : ''}
      </div>

      <p>If you have any questions, reply to this email or contact us at <a href="mailto:commercial@markebmedia.com" style="color:#B46100;">commercial@markebmedia.com</a>.</p>
      <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
    </div>

    <div class="footer">
      <strong>Markeb Media Ltd</strong>
      <div class="footer-divider"></div>
      <p style="margin:0 0 6px;">Spaces Pennine 5, 20-22 Hawley Street, Sheffield, S1 2EA</p>
      <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
      <p style="margin-top:12px;font-size:12px;color:rgba(253,243,226,0.5);">Company No. 15919272 &nbsp;·&nbsp; VAT No. 498 4447 31</p>
    </div>
  </div>
</body>
</html>`;

      try {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: actualClientEmail,
          bcc: BCC_EMAIL,
          subject: `🎉 Your Content is Ready — ${ref || invoiceNum} — Markeb Media`,
          html: contentReadyHtml
        });
        console.log('✅ Content-ready notification sent to client:', actualClientEmail);
      } catch (clientEmailErr) {
        // Non-blocking — payment has already been processed successfully;
        // don't fail the whole webhook over this secondary notification.
        console.error('⚠️ Failed to send content-ready email to client (non-blocking):', clientEmailErr.message);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true, invoiceNum, status: 'paid' })
    };

  } catch (err) {
    console.error('invoice-payment-webhook error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};