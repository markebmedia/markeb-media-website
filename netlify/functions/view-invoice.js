// netlify/functions/view-invoice.js
// Renders the invoice page with Pay Now button (Apple Pay / Google Pay / card)
// Stripe Payment Element handles all payment methods automatically

const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const STRIPE_PUBLIC_KEY = process.env.STRIPE_PUBLIC_KEY;

exports.handler = async (event) => {
  const rawRef = event.queryStringParameters?.ref
    || (event.path || '').split('/invoice/')[1]
    || '';
  const ref = rawRef.trim().toUpperCase();

  if (!ref) {
    return errorPage('Missing invoice reference', 'Please provide a valid invoice reference in the URL.');
  }

  try {
    const bookingRef = ref.startsWith('INV-MM') ? ref.slice(6) : ref;
    const invoiceNum = ref.startsWith('INV-MM') ? ref : `INV-MM${ref}`;

    const records = await base('Bookings')
      .select({ filterByFormula: `{Booking Reference} = "${bookingRef}"`, maxRecords: 1 })
      .firstPage();

    if (!records || records.length === 0) {
      return errorPage('Invoice not found', `No invoice found for reference ${invoiceNum}. Please check the reference and try again.`);
    }

    const booking = { id: records[0].id, fields: records[0].fields };
    const html = buildInvoiceHTML(booking, invoiceNum);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html
    };

  } catch (err) {
    console.error('view-invoice error:', err);
    return errorPage('Error loading invoice', 'Something went wrong. Please try again or contact commercial@markebmedia.com.');
  }
};

function errorPage(title, message) {
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Markeb Media</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background: #f7ead5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
    .box { background: #FDF3E2; border-radius: 16px; padding: 48px 40px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 8px 40px rgba(61,48,18,0.15); }
    h1 { color: #3F4D1B; font-size: 22px; margin: 0 0 12px; }
    p { color: #6b4f2a; font-size: 15px; line-height: 1.6; margin: 0; }
    a { color: #B46100; }
  </style>
</head>
<body>
  <div class="box">
    <div style="font-size:48px;margin-bottom:16px;">📄</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`
  };
}

function buildInvoiceHTML(booking, invoiceNum) {
  const f = booking.fields;
  const ref = f['Booking Reference'] || booking.id.slice(-6).toUpperCase();

  const today = new Date();
  const fmt = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const isPaid = (f['Payment Status'] || '').toLowerCase() === 'paid';
  const finalPrice = parseFloat(f['Final Price'] || 0);
  const exVAT = parseFloat(f['Price Ex VAT'] || (finalPrice / 1.2).toFixed(2));
  const vatAmount = parseFloat(f['VAT Amount'] || (finalPrice - exVAT).toFixed(2));
  const bedroomFee = parseFloat(f['Extra Bedroom Fee'] || 0);
  const sqftFee = parseFloat(f['Square Footage Fee'] || 0);
  const addonsRaw = f['Add-Ons'] || f['Add-ons'] || '';
  const addonsPrice = parseFloat(f['Add-ons Price'] || f['Addons Price'] || 0);
  const discountCode = f['Discount Code'] || '';
  const discountAmount = parseFloat(f['Discount Amount'] || 0);
  const bedrooms = parseInt(f['Bedrooms'] || 0);
  const address = f['Property Address'] || '';
  const postcode = f['Postcode'] || '';
  const date = f['Date'] || '';
  const time = f['Time'] || '';
  const clientName = f['Client Name'] || '';
  const clientEmail = f['Client Email'] || '';

  let shootDate = '';
  if (date) {
    const [y, m, d2] = date.split('-').map(Number);
    shootDate = new Date(y, m - 1, d2).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
  }

  const statusPillStyle = isPaid
    ? 'background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.4);color:#10b981;'
    : 'background:rgba(245,158,11,0.2);border:1px solid rgba(245,158,11,0.4);color:#f59e0b;';
  const statusLabel = isPaid ? '✅ Paid' : '⏳ Awaiting Payment';

  // Build line items
  const lines = [];
  lines.push({
    desc: f['Service'] || '',
    sub: `Shoot date: ${shootDate}${time ? ' at ' + time : ''}${bedrooms ? ' · ' + bedrooms + ' bedrooms' : ''}`,
    sub2: address ? `${address}${postcode ? ', ' + postcode : ''}` : '',
    ref: ref,
    amount: exVAT
  });

  if (bedroomFee > 0) {
    const extraBeds = Math.max(0, bedrooms - 4);
    lines.push({ desc: `Extra bedrooms (${extraBeds} × £25)`, sub: '', sub2: '', ref: '', amount: bedroomFee });
  }
  if (sqftFee > 0) {
    lines.push({ desc: 'Large property fee (property over 3,000 sq ft)', sub: '', sub2: '', ref: '', amount: sqftFee });
  }
  if (addonsRaw) {
    const addonLines = addonsRaw.split('\n').map(s => s.trim()).filter(Boolean);
    const structured = addonLines.map(line => {
      const match = line.match(/^(.+?)\s*\(\+£([\d.]+)\)$/);
      if (match) return { name: match[1].trim(), price: parseFloat(match[2]) };
      return { name: line.replace(/\s*\(\+£[\d.]+\)$/, '').trim(), price: null };
    }).filter(a => a.name);

    if (structured.length > 0 && structured.some(a => a.price !== null)) {
      structured.forEach(a => lines.push({ desc: a.name, sub: '', sub2: '', ref: '', amount: a.price }));
    } else {
      const addonList = addonsRaw.split(',').map(a => a.trim()).filter(Boolean);
      const priceEach = addonList.length > 0 && addonsPrice > 0 ? addonsPrice / addonList.length : 0;
      addonList.forEach(a => lines.push({ desc: a, sub: '', sub2: '', ref: '', amount: priceEach > 0 ? priceEach : null }));
    }
  }

  const linesHTML = lines.map(l => `
    <tr>
      <td style="padding:12px 16px;vertical-align:top;border-bottom:1px solid #e8d5b5;">
        <div style="font-weight:600;color:#2d1f00;font-size:14px;">${l.desc}</div>
        ${l.sub ? `<div style="font-size:11px;color:#8a6e44;margin-top:3px;">${l.sub}</div>` : ''}
        ${l.sub2 ? `<div style="font-size:11px;color:#8a6e44;">${l.sub2}</div>` : ''}
      </td>
      <td style="padding:12px 16px;vertical-align:top;border-bottom:1px solid #e8d5b5;font-size:12px;color:#8a6e44;font-family:monospace;white-space:nowrap;">${l.ref || ''}</td>
      <td style="padding:12px 16px;vertical-align:top;border-bottom:1px solid #e8d5b5;text-align:right;font-family:monospace;font-size:13px;color:#2d1f00;white-space:nowrap;">
        ${l.amount !== null && l.amount !== undefined ? `£${parseFloat(l.amount).toFixed(2)}` : '—'}
      </td>
    </tr>`).join('');

  const discountRow = discountCode && discountAmount > 0 ? `
    <tr>
      <td colspan="2" style="padding:12px 16px;border-bottom:1px solid #e8d5b5;">
        <div style="color:#10b981;font-size:14px;font-weight:500;">Discount — ${discountCode}</div>
      </td>
      <td style="padding:12px 16px;text-align:right;border-bottom:1px solid #e8d5b5;font-family:monospace;font-size:13px;color:#10b981;white-space:nowrap;">−£${discountAmount.toFixed(2)}</td>
    </tr>` : '';

  const paidStampHTML = isPaid ? `
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-18deg);border:5px solid rgba(16,185,129,0.35);border-radius:12px;padding:10px 28px;pointer-events:none;z-index:1;">
      <div style="font-size:44px;font-weight:800;color:rgba(16,185,129,0.35);letter-spacing:0.1em;white-space:nowrap;">PAID</div>
    </div>` : '';

  // Pay Now section — only shown if unpaid
  const payNowSection = !isPaid ? `
    <!-- Pay Now -->
    <div id="pay-now-section" style="margin-bottom:28px;">
      <div style="background:linear-gradient(135deg,#3F4D1B 0%,#2d3813 100%);border-radius:14px;padding:24px;margin-bottom:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:13px;font-weight:700;color:rgba(253,243,226,0.65);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">Pay Now</div>
            <div style="font-size:22px;font-weight:700;color:#FDF3E2;font-family:monospace;">£${finalPrice.toFixed(2)}</div>
            <div style="font-size:12px;color:rgba(253,243,226,0.5);margin-top:2px;">inc. VAT · ${invoiceNum}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Apple_Pay_logo.svg/120px-Apple_Pay_logo.svg.png" alt="Apple Pay" style="height:22px;opacity:0.85;">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Google_Pay_Logo.svg/120px-Google_Pay_Logo.svg.png" alt="Google Pay" style="height:22px;opacity:0.85;">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Visa_Inc._logo.svg/120px-Visa_Inc._logo.svg.png" alt="Visa" style="height:14px;opacity:0.85;">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Mastercard-logo.svg/120px-Mastercard-logo.svg.png" alt="Mastercard" style="height:22px;opacity:0.85;">
          </div>
        </div>

        <!-- Payment Element mounts here -->
        <div id="payment-element-wrap" style="display:none;">
          <div id="payment-element" style="margin-bottom:16px;"></div>
          <div id="payment-error" style="display:none;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);border-radius:8px;padding:12px 14px;font-size:13px;color:#fca5a5;margin-bottom:14px;"></div>
          <button id="pay-submit-btn" style="width:100%;padding:14px;background:#B46100;color:#FDF3E2;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;letter-spacing:0.01em;">
            Pay £${finalPrice.toFixed(2)} Now
          </button>
          <button id="pay-cancel-btn" onclick="cancelPay()" style="width:100%;padding:10px;background:transparent;color:rgba(253,243,226,0.5);border:none;font-size:13px;cursor:pointer;margin-top:8px;font-family:'Inter',sans-serif;">
            Cancel
          </button>
        </div>

        <!-- Initial pay button -->
        <div id="pay-trigger-wrap">
          <button id="pay-trigger-btn" onclick="initPayment()" style="width:100%;padding:14px;background:#B46100;color:#FDF3E2;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;letter-spacing:0.01em;">
            Pay Now
          </button>
          <div style="text-align:center;margin-top:10px;font-size:12px;color:rgba(253,243,226,0.45);">
            🔒 Secured by Stripe · Apple Pay · Google Pay · Card
          </div>
        </div>

        <!-- Loading state -->
        <div id="pay-loading" style="display:none;text-align:center;padding:20px 0;">
          <div style="width:28px;height:28px;border:3px solid rgba(253,243,226,0.2);border-top:3px solid #FDF3E2;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 10px;"></div>
          <div style="font-size:13px;color:rgba(253,243,226,0.6);">Loading payment...</div>
        </div>

        <!-- Success state -->
        <div id="pay-success" style="display:none;text-align:center;padding:20px 0;">
          <div style="font-size:40px;margin-bottom:10px;">✅</div>
          <div style="font-size:16px;font-weight:700;color:#FDF3E2;margin-bottom:6px;">Payment received!</div>
          <div style="font-size:13px;color:rgba(253,243,226,0.7);">A confirmation email is on its way to ${clientEmail}</div>
        </div>

      </div>
    </div>

    <style>
      @keyframes spin { to { transform: rotate(360deg); } }
      #payment-element .StripeElement { background: #fff; }
    </style>

    <script src="https://js.stripe.com/v3/"></script>
    <script>
      const STRIPE_PK = '${STRIPE_PUBLIC_KEY}';
      const INVOICE_NUM = '${invoiceNum}';
      let stripe, elements;

      async function initPayment() {
        document.getElementById('pay-trigger-wrap').style.display = 'none';
        document.getElementById('pay-loading').style.display = 'block';

        try {
          const res = await fetch('/.netlify/functions/create-invoice-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceNum: INVOICE_NUM })
          });
          const data = await res.json();

          if (!data.success || !data.clientSecret) {
            throw new Error(data.error || 'Failed to initialise payment');
          }

          stripe = Stripe(STRIPE_PK);
          elements = stripe.elements({
            clientSecret: data.clientSecret,
            appearance: {
              theme: 'stripe',
              variables: {
                colorPrimary: '#B46100',
                colorBackground: '#ffffff',
                colorText: '#2d1f00',
                colorDanger: '#ef4444',
                fontFamily: 'Inter, system-ui, sans-serif',
                borderRadius: '8px'
              }
            }
          });

          const paymentElement = elements.create('payment', {
            layout: 'tabs'
          });
          paymentElement.mount('#payment-element');

          document.getElementById('pay-loading').style.display = 'none';
          document.getElementById('payment-element-wrap').style.display = 'block';

          document.getElementById('pay-submit-btn').addEventListener('click', submitPayment);

        } catch (err) {
          document.getElementById('pay-loading').style.display = 'none';
          document.getElementById('pay-trigger-wrap').style.display = 'block';
          alert('Could not load payment form: ' + err.message);
        }
      }

      async function submitPayment() {
        const btn = document.getElementById('pay-submit-btn');
        const errorEl = document.getElementById('payment-error');
        btn.disabled = true;
        btn.textContent = 'Processing...';
        errorEl.style.display = 'none';

        let confirmResult;
        try {
          confirmResult = await stripe.confirmPayment({
          elements,
          confirmParams: {
            return_url: window.location.href + '?paid=1'
          },
          redirect: 'if_required'
        });

        } catch (e) {
          errorEl.textContent = 'Payment error: ' + e.message;
          errorEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Pay £${finalPrice.toFixed(2)} Now';
          return;
        }
        const { error } = confirmResult || {};
        if (error) {
          errorEl.textContent = error.message;
          errorEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Pay £${finalPrice.toFixed(2)} Now';
        } else {
          // Payment succeeded without redirect (e.g. card, Apple Pay, Google Pay)
          document.getElementById('payment-element-wrap').style.display = 'none';
          document.getElementById('pay-success').style.display = 'block';
          // Update status pill
          const pill = document.getElementById('status-pill');
          if (pill) {
            pill.textContent = '✅ Paid';
            pill.style.cssText = 'background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.4);color:#10b981;display:inline-flex;align-items:center;gap:5px;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:600;margin-top:12px;';
          }
        }
      }

      function cancelPay() {
        document.getElementById('payment-element-wrap').style.display = 'none';
        document.getElementById('pay-trigger-wrap').style.display = 'block';
      }

      // Handle return from 3DS redirect
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('paid') === '1') {
        document.addEventListener('DOMContentLoaded', () => {
          const section = document.getElementById('pay-trigger-wrap');
          const success = document.getElementById('pay-success');
          if (section) section.style.display = 'none';
          if (success) success.style.display = 'block';
        });
      }
    </script>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${invoiceNum} — Markeb Media</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter',sans-serif;background:#f7ead5;color:#2d1f00;min-height:100vh;padding:40px 20px;}
.page{max-width:760px;margin:0 auto;background:#FDF3E2;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(61,48,18,0.18);position:relative;}
.head{background:#3F4D1B;padding:36px 40px;display:flex;justify-content:space-between;align-items:flex-start;gap:20px;}
.head-left{display:flex;flex-direction:column;gap:10px;align-items:flex-start;}
.logo-wrap{background:#FDF3E2;border-radius:10px;padding:10px 14px;display:inline-flex;align-items:center;justify-content:center;}
.logo-wrap img{height:48px;width:auto;display:block;}
.inv-badge{background:#B46100;color:#FDF3E2;font-size:10px;font-weight:700;padding:4px 14px;border-radius:4px;letter-spacing:0.12em;text-transform:uppercase;}
.head-right{text-align:right;flex-shrink:0;}
.inv-num{font-size:22px;font-weight:700;color:#FDF3E2;font-family:monospace;letter-spacing:0.02em;}
.inv-meta{font-size:12px;color:rgba(253,243,226,0.6);margin-top:8px;line-height:1.9;}
.body{padding:36px 40px;position:relative;}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:32px;}
.party-label{font-size:10px;font-weight:700;color:#8a6e44;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;}
.party-name{font-size:15px;font-weight:700;color:#2d1f00;}
.party-detail{font-size:12px;color:#6b4f2a;line-height:1.75;margin-top:4px;}
table.lines{width:100%;border-collapse:collapse;margin-bottom:24px;}
table.lines th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8a6e44;padding:8px 16px;border-bottom:2px solid #e8d5b5;text-align:left;background:#f7ead5;}
table.lines th:last-child{text-align:right;}
.totals-wrap{margin-left:auto;width:290px;margin-bottom:28px;}
.total-row{display:flex;justify-content:space-between;font-size:13px;color:#6b4f2a;padding:4px 0;}
.total-row.grand{font-size:17px;font-weight:700;color:#2d1f00;border-top:2px solid #d4b896;padding-top:10px;margin-top:8px;}
.total-row.grand .tv{color:#B46100;font-family:monospace;}
.tv{font-family:monospace;font-size:13px;}
.bank-box{background:#f0e3c8;border:1.5px solid #e8d5b5;border-radius:10px;padding:20px 24px;margin-bottom:24px;}
.bank-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8a6e44;margin-bottom:14px;}
.bank-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 32px;}
.bk-label{font-size:11px;color:#8a6e44;margin-bottom:2px;}
.bk-val{font-size:14px;font-weight:600;color:#2d1f00;font-family:monospace;}
.foot{background:#f0e3c8;border-top:1.5px solid #e8d5b5;padding:18px 40px;display:flex;justify-content:space-between;align-items:center;gap:12px;}
.foot-note{font-size:11px;color:#8a6e44;line-height:1.6;}
.print-bar{max-width:760px;margin:0 auto 20px;display:flex;gap:10px;}
@media(max-width:600px){
  .head{flex-direction:column;gap:16px;padding:24px 20px;}
  .head-right{text-align:left;}
  .body{padding:24px 20px;}
  .parties{grid-template-columns:1fr;gap:20px;}
  .bank-grid{grid-template-columns:1fr;}
  .totals-wrap{width:100%;}
  .foot{flex-direction:column;padding:16px 20px;text-align:center;}
}
@media print{
  body{background:#FDF3E2;padding:0;}
  .page{box-shadow:none;border-radius:0;max-width:100%;}
  .print-bar{display:none!important;}
  #pay-now-section{display:none!important;}
}
</style>
</head>
<body>

<div class="print-bar">
  <button onclick="window.print()" style="padding:10px 22px;background:#3F4D1B;color:#FDF3E2;border:none;border-radius:8px;font-family:'Inter',sans-serif;font-weight:600;font-size:14px;cursor:pointer;">🖨 Print / Save as PDF</button>
</div>

<div class="page">
  <div class="head">
    <div class="head-left">
      <div class="logo-wrap">
        <img src="https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png" alt="Markeb Media" />
      </div>
      <div class="inv-badge">Invoice</div>
    </div>
    <div class="head-right">
      <div class="inv-num">${invoiceNum}</div>
      <div class="inv-meta">
        Issued: ${fmt(today)}<br>
        Due on receipt
      </div>
      <span id="status-pill" style="${statusPillStyle}display:inline-flex;align-items:center;gap:5px;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:600;margin-top:12px;">${statusLabel}</span>
    </div>
  </div>

  <div class="body">
    ${paidStampHTML}

    <div class="parties">
      <div>
        <div class="party-label">From</div>
        <div class="party-name">Markeb Media Ltd</div>
        <div class="party-detail">
          Spaces Pennine 5<br>
          20-22 Hawley Street<br>
          Sheffield, England, S1 2EA<br>
          commercial@markebmedia.com<br>
          markebmedia.com
        </div>
      </div>
      <div>
        <div class="party-label">Billed to</div>
        <div class="party-name">${clientName}</div>
        <div class="party-detail">${clientEmail}</div>
      </div>
    </div>

    <table class="lines">
      <thead>
        <tr>
          <th>Description</th>
          <th>Booking ref</th>
          <th style="text-align:right;">Amount (ex VAT)</th>
        </tr>
      </thead>
      <tbody>
        ${linesHTML}
        ${discountRow}
      </tbody>
    </table>

    <div class="totals-wrap">
      <div class="total-row"><span>Subtotal (ex VAT)</span><span class="tv">£${exVAT.toFixed(2)}</span></div>
      <div class="total-row"><span>VAT @ 20%</span><span class="tv">£${vatAmount.toFixed(2)}</span></div>
      <div class="total-row grand"><span>Total ${isPaid ? 'paid' : 'due'}</span><span class="tv">£${finalPrice.toFixed(2)}</span></div>
    </div>

    ${payNowSection}

    ${!isPaid ? `
    <div class="bank-box">
      <div class="bank-title">Or pay by Bank Transfer</div>
      <div class="bank-grid">
        <div><div class="bk-label">Account name</div><div class="bk-val">Markeb Media Ltd</div></div>
        <div><div class="bk-label">Sort code</div><div class="bk-val">04-00-03</div></div>
        <div><div class="bk-label">Account number</div><div class="bk-val">57382906</div></div>
        <div><div class="bk-label">Payment reference</div><div class="bk-val">${invoiceNum}</div></div>
      </div>
    </div>` : `
    <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin-bottom:24px;display:flex;align-items:center;gap:12px;">
      <div style="font-size:28px;">✅</div>
      <div>
        <div style="font-size:14px;font-weight:700;color:#065f46;">Payment received — thank you</div>
        <div style="font-size:12px;color:#047857;margin-top:2px;">This invoice has been settled. Please retain for your records.</div>
      </div>
    </div>`}
  </div>

  <div class="foot">
    <div class="foot-note">
      ${!isPaid ? 'Payment terms: Due on receipt · Thank you for your business.' : 'Thank you for your business.'}<br>
      Company No. 15919272 · VAT No. 498 4447 31
    </div>
    <div class="foot-note" style="text-align:right;">
      Markeb Media Ltd<br>
      Sheffield, England
    </div>
  </div>
</div>

</body>
</html>`;
}