// ===== chase-overdue-invoices.js =====
// Netlify Scheduled Function — runs daily at 08:00 UTC
// Finds invoices sent 3+ days ago, still unpaid, not yet auto-chased
// and sends a payment reminder email for each one.

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const RESEND_API_KEY   = process.env.RESEND_API_KEY;
const SITE_URL         = process.env.URL || 'https://markebmedia.com';

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

async function airtableGet(table, filterFormula) {
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`);
  url.searchParams.set('filterByFormula', filterFormula);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable GET ${table} failed: ${err}`);
  }

  const data = await res.json();
  return data.records || [];
}

async function airtablePatch(table, recordId, fields) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}/${recordId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable PATCH ${table}/${recordId} failed: ${err}`);
  }

  return res.json();
}

// ── Invoice email builder (reminder variant) ──────────────────────────────────

function buildReminderEmail({ invoiceNum, clientName, clientEmail, amount, bookingRef, service, shootDate }) {
  const exVAT    = parseFloat((amount / 1.2).toFixed(2));
  const vatAmt   = parseFloat((amount - exVAT).toFixed(2));
  const dueLabel = `£${amount.toFixed(2)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Payment Reminder — ${invoiceNum}</title>
</head>
<body style="margin:0;padding:0;background:#f7ead5;font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:620px;margin:40px auto;background:#FDF3E2;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(61,48,18,0.12);">

    <!-- Header -->
    <div style="background:#3F4D1B;padding:32px 40px;display:flex;align-items:center;gap:16px;">
      <img src="https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png" alt="Markeb Media" style="height:48px;width:auto;">
      <div style="color:#FDF3E2;font-size:18px;font-weight:700;letter-spacing:-0.01em;">Markeb Media</div>
    </div>

    <!-- Reminder banner -->
    <div style="background:#ef4444;padding:20px 40px;text-align:center;">
      <div style="color:#fff;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">⏰ Payment Reminder</div>
      <div style="color:rgba(255,255,255,0.9);font-size:15px;">Invoice ${invoiceNum} remains outstanding</div>
    </div>

    <!-- Body -->
    <div style="padding:36px 40px;">
      <p style="color:#2d1f00;font-size:15px;margin:0 0 16px;">Hi ${clientName},</p>
      <p style="color:#2d1f00;font-size:15px;margin:0 0 24px;">
        This is a friendly reminder that the invoice below remains outstanding.
        Please arrange payment at your earliest convenience using the bank details provided.
      </p>

      <!-- Invoice summary -->
      <div style="background:#f0e3c8;border:1.5px solid #e8d5b5;border-radius:10px;padding:20px 24px;margin-bottom:28px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8a6e44;margin-bottom:14px;">Invoice Summary</div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:13px;color:#6b4f2a;">Invoice number</span>
          <span style="font-size:13px;font-weight:700;color:#2d1f00;font-family:monospace;">${invoiceNum}</span>
        </div>
        ${service ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:13px;color:#6b4f2a;">Service</span>
          <span style="font-size:13px;font-weight:600;color:#2d1f00;">${service}</span>
        </div>` : ''}
        ${shootDate ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:13px;color:#6b4f2a;">Shoot date</span>
          <span style="font-size:13px;font-weight:600;color:#2d1f00;">${shootDate}</span>
        </div>` : ''}
        <div style="border-top:1.5px solid #e8d5b5;margin:12px 0;"></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:13px;color:#6b4f2a;">Subtotal (ex VAT)</span>
          <span style="font-size:13px;font-family:monospace;color:#2d1f00;">£${exVAT.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
          <span style="font-size:13px;color:#6b4f2a;">VAT @ 20%</span>
          <span style="font-size:13px;font-family:monospace;color:#2d1f00;">£${vatAmt.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="font-size:16px;font-weight:700;color:#2d1f00;">Total due</span>
          <span style="font-size:16px;font-weight:700;color:#B46100;font-family:monospace;">${dueLabel}</span>
        </div>
      </div>

      <!-- Bank details -->
      <div style="background:#f0e3c8;border:1.5px solid #e8d5b5;border-radius:10px;padding:20px 24px;margin-bottom:28px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8a6e44;margin-bottom:14px;">Bank Transfer Details</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 32px;">
          <div>
            <div style="font-size:11px;color:#8a6e44;margin-bottom:2px;">Account name</div>
            <div style="font-size:14px;font-weight:600;color:#2d1f00;font-family:monospace;">Markeb Media Ltd</div>
          </div>
          <div>
            <div style="font-size:11px;color:#8a6e44;margin-bottom:2px;">Sort code</div>
            <div style="font-size:14px;font-weight:600;color:#2d1f00;font-family:monospace;">04-00-03</div>
          </div>
          <div>
            <div style="font-size:11px;color:#8a6e44;margin-bottom:2px;">Account number</div>
            <div style="font-size:14px;font-weight:600;color:#2d1f00;font-family:monospace;">57382906</div>
          </div>
          <div>
            <div style="font-size:11px;color:#8a6e44;margin-bottom:2px;">Payment reference</div>
            <div style="font-size:14px;font-weight:600;color:#2d1f00;font-family:monospace;">${invoiceNum}</div>
          </div>
        </div>
      </div>

      <p style="color:#6b4f2a;font-size:13px;margin:0;">
        If you have any questions or have already arranged payment, please disregard this reminder or reply to this email.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#3F4D1B;padding:20px 40px;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:11px;color:rgba(253,243,226,0.6);line-height:1.6;">
        Payment terms: Due on receipt<br>
        Company No. 15919272 · VAT No. 498 4447 31
      </div>
      <div style="font-size:11px;color:rgba(253,243,226,0.6);text-align:right;line-height:1.6;">
        Markeb Media Ltd<br>
        Sheffield, England
      </div>
    </div>

  </div>
</body>
</html>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler() {
  console.log(`[chase-overdue-invoices] Running at ${new Date().toISOString()}`);

  const cutoff = daysAgo(3); // 3+ days ago

  // Fetch all unpaid invoices where:
  // - Sent Date is set and is 3+ days ago
  // - Auto Chase Sent is not checked
  const filterFormula = `AND(
    {Status} = "Unpaid",
    {Sent Date} != "",
    {Sent Date} <= "${cutoff}",
    {Auto Chase Sent} != TRUE()
  )`;

  let invoices;
  try {
    invoices = await airtableGet('Invoices', filterFormula);
  } catch (err) {
    console.error('[chase-overdue-invoices] Failed to fetch invoices:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }

  console.log(`[chase-overdue-invoices] Found ${invoices.length} invoice(s) to chase`);

  if (invoices.length === 0) {
    return new Response(JSON.stringify({ sent: 0, message: 'No overdue invoices to chase' }), { status: 200 });
  }

  const results = { sent: 0, failed: 0, skipped: 0, details: [] };

  for (const record of invoices) {
    const f = record.fields;
    const invoiceNum  = f['Invoice Number'] || '';
    const clientName  = f['Client Name']    || '';
    const clientEmail = f['Client Email']   || '';
    const amount      = parseFloat(f['Amount'] || 0);
    const bookingRef  = f['Booking Reference'] || '';
    const service     = f['Service'] || '';
    const shootDate   = f['Shoot Date'] || '';
    const sentDate    = f['Sent Date'] || '';

    if (!clientEmail || !invoiceNum || amount <= 0) {
      console.warn(`[chase-overdue-invoices] Skipping ${record.id} — missing data`);
      results.skipped++;
      results.details.push({ invoiceNum, status: 'skipped', reason: 'missing email/invoiceNum/amount' });
      continue;
    }

    console.log(`[chase-overdue-invoices] Chasing ${invoiceNum} → ${clientEmail} (sent ${sentDate})`);

    // Build and send reminder email via Resend
    try {
      const html = buildReminderEmail({ invoiceNum, clientName, clientEmail, amount, bookingRef, service, shootDate });

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Markeb Media <commercial@markebmedia.com>',
          to: [clientEmail],
          bcc: ['commercial@markebmedia.com'],
          subject: `⏰ Payment Reminder — Invoice ${invoiceNum} — Markeb Media`,
          html
        })
      });

      if (!emailRes.ok) {
        const err = await emailRes.text();
        throw new Error(`Resend error: ${err}`);
      }

      // Mark as auto-chased in Airtable
      await airtablePatch('Invoices', record.id, {
        'Auto Chase Sent': true,
        'Auto Chase Date': todayStr()
      });

      results.sent++;
      results.details.push({ invoiceNum, clientEmail, status: 'sent' });
      console.log(`[chase-overdue-invoices] ✅ Sent reminder for ${invoiceNum}`);

    } catch (err) {
      console.error(`[chase-overdue-invoices] ❌ Failed for ${invoiceNum}:`, err.message);
      results.failed++;
      results.details.push({ invoiceNum, clientEmail, status: 'failed', error: err.message });
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`[chase-overdue-invoices] Done — sent: ${results.sent}, failed: ${results.failed}, skipped: ${results.skipped}`);

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}