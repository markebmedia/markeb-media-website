const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const BCC_EMAIL = 'commercial@markebmedia.com';
const LOGO_URL = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';
const SITE_URL = 'https://markebmedia.com';

function getEmailLayout(content) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markeb Media</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #3F4D1B;
      background-color: #f7ead5;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #FDF3E2;
    }
    .header {
      background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%);
      padding: 40px 20px;
      text-align: center;
    }
    .header img {
      max-width: 200px;
      width: 100%;
      height: auto;
      margin-bottom: 20px;
    }
    .header h1 {
      color: #FDF3E2;
      margin: 0;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .header-accent {
      width: 40px;
      height: 3px;
      background: #B46100;
      margin: 14px auto 0;
      border-radius: 2px;
    }
    .content {
      padding: 40px 30px;
    }
    .content h2 {
      color: #3F4D1B;
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 8px;
    }
    .content p {
      color: #3F4D1B;
      margin: 0 0 14px;
    }
    .booking-details {
      background-color: #f7ead5;
      border: 2px solid #e8d9be;
      border-radius: 12px;
      padding: 24px;
      margin: 24px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #e8d9be;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      color: #6b7c2e;
      font-weight: 600;
      font-size: 14px;
    }
    .detail-value {
      color: #3F4D1B;
      font-weight: 600;
      text-align: right;
      max-width: 60%;
      font-size: 14px;
    }
    .button {
      display: inline-block;
      background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%);
      color: #FDF3E2 !important;
      padding: 14px 32px;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 600;
      margin: 20px 0;
      font-size: 15px;
    }
    .alert {
      padding: 16px;
      border-radius: 8px;
      margin: 20px 0;
      font-size: 14px;
    }
    .alert-info {
      background-color: #fff8ee;
      border: 2px solid #B46100;
      color: #8a4a00;
    }
    .alert-warning {
      background-color: #fef9ec;
      border: 2px solid #cc7a1a;
      color: #7a3e00;
    }
    .alert-success {
      background-color: #f3f7e8;
      border: 2px solid #3F4D1B;
      color: #3F4D1B;
    }
    .alert-danger {
      background-color: #fef2f2;
      border: 2px solid #fca5a5;
      color: #7f1d1d;
    }
    .footer {
      background-color: #3F4D1B;
      padding: 30px;
      text-align: center;
      color: rgba(253,243,226,0.7);
      font-size: 14px;
    }
    .footer strong {
      color: #FDF3E2;
    }
    .footer a {
      color: #B46100;
      text-decoration: none;
    }
    .footer-divider {
      width: 32px;
      height: 2px;
      background: #B46100;
      margin: 16px auto;
      border-radius: 1px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Markeb Media">
      <h1>Markeb Media</h1>
      <div class="header-accent"></div>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <strong>Markeb Media</strong>
      <div class="footer-divider"></div>
      <p style="margin:0 0 6px;">Professional Property Media, Marketing &amp; Technology</p>
      <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
      <p style="margin-top:16px;font-size:12px;color:rgba(253,243,226,0.4);">Markeb Media Ltd — Company No. 15919272</p>
    </div>
  </div>
</body>
</html>
  `;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email, status, reason } = JSON.parse(event.body);

    if (!email || !status) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const isSuspended = status === 'Suspended';

    const subject = isSuspended
      ? 'Important: Your Markeb Media Account Has Been Suspended'
      : 'Your Markeb Media Account Has Been Reinstated';

    const content = isSuspended ? `
      <h2>⚠️ Account Suspended</h2>
      <p>Your Markeb Media client dashboard account has been temporarily suspended.</p>

      <div class="booking-details">
        <div class="detail-row">
          <span class="detail-label">Account Status</span>
          <span class="detail-value">Suspended</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Reason</span>
          <span class="detail-value">${reason || 'Please contact us for more information'}</span>
        </div>
      </div>

      <div class="alert alert-danger">
        <strong>⛔ Access Restricted</strong><br>
        You are currently unable to log in to your dashboard or make new bookings. Any existing scheduled bookings may be affected.
      </div>

      <div class="alert alert-info">
        <strong>📞 Want to Resolve This?</strong><br>
        If you believe this is an error or would like to settle any outstanding balance, please contact us and we will get this resolved as quickly as possible.
      </div>

      <center>
        <a href="mailto:commercial@markebmedia.com" class="button">Contact Us to Resolve</a>
      </center>

      <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
    ` : `
      <h2>✅ Account Reinstated</h2>
      <p>Great news — your Markeb Media client dashboard account has been reinstated and is fully active again.</p>

      <div class="alert alert-success">
        <strong>✅ Full Access Restored</strong><br>
        You can now log in to your dashboard and make bookings as normal.
      </div>

      <div class="booking-details">
        <div class="detail-row">
          <span class="detail-label">Account Status</span>
          <span class="detail-value">Active</span>
        </div>
      </div>

      <div class="alert alert-info">
        <strong>Need a hand getting started?</strong><br>
        If you have any questions or need assistance, don't hesitate to get in touch.
      </div>

      <center>
        <a href="${SITE_URL}/login" class="button">Log In to Your Dashboard</a>
      </center>

      <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
    `;

    const html = getEmailLayout(content);

    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      bcc: BCC_EMAIL,
      subject,
      html
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };

  } catch (error) {
    console.error('Send suspension email error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};