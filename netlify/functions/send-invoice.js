const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const BCC_EMAIL = 'commercial@markebmedia.com';
const LOGO_URL = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';

function getEmailLayout(content) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markeb Media Invoice</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #3F4D1B; background-color: #f7ead5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background-color: #FDF3E2; }
    .header { background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%); padding: 40px 20px; text-align: center; }
    .header img { max-width: 200px; width: 100%; height: auto; margin-bottom: 20px; }
    .header h1 { color: #FDF3E2; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
    .header-accent { width: 40px; height: 3px; background: #B46100; margin: 14px auto 0; border-radius: 2px; }
    .inv-badge { display: inline-block; background: #B46100; color: #FDF3E2; font-size: 11px; font-weight: 700; padding: 4px 14px; border-radius: 4px; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 14px; }
    .content { padding: 40px 30px; }
    .content h2 { color: #3F4D1B; font-size: 22px; font-weight: 700; margin: 0 0 8px; }
    .content p { color: #3F4D1B; margin: 0 0 14px; }
    .inv-meta { background: #f7ead5; border: 2px solid #e8d9be; border-radius: 12px; padding: 20px 24px; margin: 24px 0; }
    .inv-meta-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #e8d9be; font-size: 14px; }
    .inv-meta-row:last-child { border-bottom: none; }
    .inv-meta-label { color: #6b7c2e; font-weight: 600; }
    .inv-meta-value { color: #3F4D1B; font-weight: 600; text-align: right; }
    .inv-table-wrap { margin: 24px 0; border: 2px solid #e8d9be; border-radius: 12px; overflow: hidden; }
    table.inv-lines { width: 100%; border-collapse: collapse; }
    table.inv-lines th { background: #f0e8d5; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7c2e; padding: 10px 16px; text-align: left; border-bottom: 2px solid #e8d9be; }
    table.inv-lines th:last-child { text-align: right; }
    table.inv-lines td { padding: 12px 16px; font-size: 14px; color: #3F4D1B; border-bottom: 1px solid #e8d9be; vertical-align: top; }
    table.inv-lines td:last-child { text-align: right; font-family: monospace; white-space: nowrap; }
    table.inv-lines tr:last-child td { border-bottom: none; }
    .inv-sub { font-size: 11px; color: #8a6e44; margin-top: 3px; }
    .discount-row td { color: #10b981; }
    .totals-section { background: #f0e8d5; border-top: 2px solid #e8d9be; padding: 16px 20px; }
    .total-line { display: flex; justify-content: space-between; font-size: 14px; color: #6b7c2e; padding: 3px 0; }
    .total-line.grand { font-size: 18px; font-weight: 700; color: #3F4D1B; border-top: 2px solid #d4b896; padding-top: 10px; margin-top: 8px; }
    .total-line.grand .tv { color: #B46100; font-family: monospace; }
    .tv { font-family: monospace; }
    .bank-box { background: #f7ead5; border: 2px solid #e8d9be; border-radius: 12px; padding: 20px 24px; margin: 24px 0; }
    .bank-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6b7c2e; margin-bottom: 14px; }
    .bank-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; }
    .bk-label { font-size: 11px; color: #8a6e44; margin-bottom: 2px; }
    .bk-val { font-size: 14px; font-weight: 700; color: #3F4D1B; font-family: monospace; }
    .paid-banner { background: #f0fdf4; border: 2px solid #bbf7d0; border-radius: 12px; padding: 18px 22px; margin: 24px 0; display: flex; align-items: center; gap: 14px; }
    .paid-icon { font-size: 32px; flex-shrink: 0; }
    .paid-text-title { font-size: 15px; font-weight: 700; color: #065f46; margin-bottom: 3px; }
    .paid-text-sub { font-size: 13px; color: #047857; }
    .status-pill { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .status-paid { background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.4); color: #065f46; }
    .status-pending { background: rgba(245,158,11,0.15); border: 1px solid rgba(245,158,11,0.4); color: #92400e; }
    .button { display: inline-block; background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); color: #FDF3E2 !important; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600; margin: 20px 0; font-size: 15px; }
    .alert-info { background: #fff8ee; border: 2px solid #B46100; border-radius: 8px; padding: 16px; margin: 16px 0; font-size: 14px; color: #8a4a00; }
    .footer { background-color: #3F4D1B; padding: 30px; text-align: center; color: rgba(253,243,226,0.7); font-size: 14px; }
    .footer strong { color: #FDF3E2; }
    .footer a { color: #B46100; text-decoration: none; }
    .footer-divider { width: 32px; height: 2px; background: #B46100; margin: 16px auto; border-radius: 1px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Markeb Media">
      <h1>Markeb Media</h1>
      <div class="header-accent"></div>
      <div class="inv-badge">Invoice</div>
    </div>
    <div class="content">
      ${content}
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
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { booking: f, invoiceNum, isPaid } = body;

    if (!f || !f.clientEmail || !invoiceNum) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const today = new Date();
    const due = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
    const fmt = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    const finalPrice = parseFloat(f.finalPrice || 0);
    const exVAT = parseFloat((finalPrice / 1.2).toFixed(2));
    const vatAmount = parseFloat((finalPrice - exVAT).toFixed(2));
    const discountCode = f.discountCode || '';
    const discountAmount = parseFloat(f.discountAmount || 0);

    // Build line items HTML
    const lines = f.lineItems || [];
    const linesHTML = lines.map(l => `
      <tr>
        <td>
          <div style="font-weight:600;">${l.desc}</div>
          ${l.sub ? `<div class="inv-sub">${l.sub}</div>` : ''}
          ${l.sub2 ? `<div class="inv-sub">${l.sub2}</div>` : ''}
        </td>
        <td style="color:#8a6e44;font-size:12px;">${l.ref || ''}</td>
        <td>${l.amount !== null && l.amount !== undefined ? `£${parseFloat(l.amount).toFixed(2)}` : '—'}</td>
      </tr>`).join('');

    const discountRow = discountCode && discountAmount > 0 ? `
      <tr class="discount-row">
        <td colspan="2"><div style="color:#10b981;font-weight:600;">Discount — ${discountCode}</div></td>
        <td style="color:#10b981;">−£${discountAmount.toFixed(2)}</td>
      </tr>` : '';

    const bankSection = !isPaid ? `
      <div class="bank-box">
        <div class="bank-title">🏦 Bank Transfer Details</div>
        <div class="bank-grid">
          <div><div class="bk-label">Account name</div><div class="bk-val">Markeb Media Ltd</div></div>
          <div><div class="bk-label">Sort code</div><div class="bk-val">04-00-03</div></div>
          <div><div class="bk-label">Account number</div><div class="bk-val">57382906</div></div>
          <div><div class="bk-label">Payment reference</div><div class="bk-val">${invoiceNum}</div></div>
        </div>
      </div>
      <div class="alert-info">
        <strong>💳 Payment terms: 14 days</strong><br>
        Please use reference <strong>${invoiceNum}</strong> when making your bank transfer so we can match your payment instantly.
      </div>` : `
      <div class="paid-banner">
        <div class="paid-icon">✅</div>
        <div>
          <div class="paid-text-title">Payment received — thank you</div>
          <div class="paid-text-sub">This invoice has been settled. Please retain for your records.</div>
        </div>
      </div>`;

    const content = `
      <h2>Your Invoice from Markeb Media</h2>
      <p>Hi ${f.clientName},</p>
      <p>${isPaid
        ? 'Please find your paid invoice below for your recent booking with Markeb Media.'
        : 'Please find your invoice below. Payment is due within 14 days — bank transfer details are included.'
      }</p>

      <div class="inv-meta">
        <div class="inv-meta-row">
          <span class="inv-meta-label">Invoice number</span>
          <span class="inv-meta-value" style="font-family:monospace;font-size:15px;letter-spacing:0.04em;">${invoiceNum}</span>
        </div>
        <div class="inv-meta-row">
          <span class="inv-meta-label">Issued</span>
          <span class="inv-meta-value">${fmt(today)}</span>
        </div>
        <div class="inv-meta-row">
          <span class="inv-meta-label">Due date</span>
          <span class="inv-meta-value">${isPaid ? 'Settled' : fmt(due)}</span>
        </div>
        <div class="inv-meta-row">
          <span class="inv-meta-label">Status</span>
          <span class="inv-meta-value">
            <span class="status-pill ${isPaid ? 'status-paid' : 'status-pending'}">${isPaid ? '✅ Paid' : '⏳ Awaiting Payment'}</span>
          </span>
        </div>
        <div class="inv-meta-row">
          <span class="inv-meta-label">Billed to</span>
          <span class="inv-meta-value">${f.clientName}<br><span style="font-size:12px;color:#8a6e44;">${f.clientEmail}</span></span>
        </div>
      </div>

      <div class="inv-table-wrap">
        <table class="inv-lines">
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
        <div class="totals-section">
          <div class="total-line"><span>Subtotal (ex VAT)</span><span class="tv">£${exVAT.toFixed(2)}</span></div>
          <div class="total-line"><span>VAT @ 20%</span><span class="tv">£${vatAmount.toFixed(2)}</span></div>
          <div class="total-line grand"><span>Total ${isPaid ? 'paid' : 'due'}</span><span class="tv">£${finalPrice.toFixed(2)}</span></div>
        </div>
      </div>

      ${bankSection}

      <p>If you have any questions about this invoice, please reply to this email or contact us at <a href="mailto:commercial@markebmedia.com" style="color:#B46100;">commercial@markebmedia.com</a>.</p>
      <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
    `;

    const emailHtml = getEmailLayout(content);

    const subject = isPaid
      ? `Invoice ${invoiceNum} — Markeb Media (Paid)`
      : `Invoice ${invoiceNum} — Markeb Media · Payment Due`;

    await resend.emails.send({
      from: FROM_EMAIL,
      to: f.clientEmail,
      bcc: BCC_EMAIL,
      subject,
      html: emailHtml
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, invoiceNum, sentTo: f.clientEmail })
    };

  } catch (err) {
    console.error('send-invoice error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};