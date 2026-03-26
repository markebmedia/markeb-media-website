// netlify/functions/notify-client-review.js
//
// Sends a branded email to the client letting them know their
// raw content is ready to review in the portal.
//
// POST body:
// {
//   clientEmail:    "client@example.com",
//   clientName:     "Sarah Johnson",
//   projectAddress: "12 Oak Street, Manchester",
//   shootDate:      "2026-03-22",
//   serviceType:    "Photography + Drone",
//   hasPhotos:      true,
//   hasVideo:       true,
// }

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const BCC_EMAIL  = 'commercial@markebmedia.com';
const SITE_URL   = 'https://markebmedia.com';
const LOGO_URL   = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';
const PORTAL_URL = process.env.PORTAL_URL || 'https://markebmedia.com/website/dashboard.html';

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

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
      margin: 16px auto 0;
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
    .content h3 {
      color: #3F4D1B;
      font-size: 16px;
      font-weight: 700;
      margin: 24px 0 8px;
    }
    .content p {
      color: #3F4D1B;
      margin: 0 0 14px;
    }
    .content ul {
      color: #3F4D1B;
      padding-left: 20px;
      margin: 0 0 14px;
    }
    .content ul li {
      margin-bottom: 6px;
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
      letter-spacing: 0.01em;
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
      <p style="margin: 0 0 6px;">Professional Property Media, Marketing &amp; Technology Solution</p>
      <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
      <p style="margin-top: 20px; font-size: 12px; color: rgba(253,243,226,0.4);">
        Need help? <a href="${SITE_URL}/contact">Contact us</a>
      </p>
    </div>
  </div>
</body>
</html>
  `;
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
    const {
      clientEmail,
      clientName,
      projectAddress,
      shootDate,
      serviceType,
      hasPhotos,
      hasVideo,
    } = JSON.parse(event.body || '{}');

    if (!clientEmail || !projectAddress) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'clientEmail and projectAddress are required' }),
      };
    }

    const firstName          = clientName ? clientName.split(' ')[0] : 'there';
    const shootDateFormatted = shootDate ? formatDate(shootDate) : null;

    const mediaTypes = [
      hasPhotos !== false && '📷 Photos',
      hasVideo  !== false && '🎬 Video',
    ].filter(Boolean).join(' & ');

    const content = `
      <h2>📷 Your Content is Ready to Review!</h2>
      <p>Hi ${firstName},</p>
      <p>Great news! Your raw ${serviceType ? `<strong>${serviceType}</strong>` : 'content'} files are now available in your Markeb Media portal. We'd love your feedback before we send everything to our editing team.</p>

      <div class="booking-details">
        <div class="detail-row">
          <span class="detail-label">Property</span>
          <span class="detail-value">${projectAddress}</span>
        </div>
        ${shootDateFormatted ? `
        <div class="detail-row">
          <span class="detail-label">Shoot Date</span>
          <span class="detail-value">${shootDateFormatted}</span>
        </div>` : ''}
        ${serviceType ? `
        <div class="detail-row">
          <span class="detail-label">Service</span>
          <span class="detail-value">${serviceType}</span>
        </div>` : ''}
        ${mediaTypes ? `
        <div class="detail-row">
          <span class="detail-label">Files Ready</span>
          <span class="detail-value">${mediaTypes}</span>
        </div>` : ''}
      </div>

      <div class="alert alert-info">
        <strong>📋 How to review your content</strong><br><br>
        1. Click the button below to log in to your portal<br>
        2. Go to the <strong>Gallery</strong> tab in the sidebar<br>
        3. Open your Dropbox folder(s) to view the raw files<br>
        4. Leave feedback in the notes boxes — photos and video separately<br>
        5. Click <strong>Approve &amp; Notify Team</strong> when you're happy
      </div>

      <center>
        <a href="${PORTAL_URL}" class="button">Review My Content →</a>
      </center>

      <div class="alert alert-success">
        <strong>✅ What happens next?</strong><br>
        Once you approve your content, our editing team will get started straight away and your finished files will be delivered within 48 hours.
      </div>

      <p>If you have any questions, feel free to reach out!</p>
      <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
    `;

    const emailHtml = getEmailLayout(content);

    await resend.emails.send({
      from:    FROM_EMAIL,
      to:      clientEmail,
      bcc:     BCC_EMAIL,
      subject: `Your content is ready to review — ${projectAddress}`,
      html:    emailHtml,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: `Notification sent to ${clientEmail}` }),
    };

  } catch (error) {
    console.error('notify-client-review error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};