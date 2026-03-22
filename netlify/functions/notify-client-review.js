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
      color: #1e293b;
      background-color: #f8fafc;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
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
      color: #ffffff;
      margin: 0;
      font-size: 28px;
      font-weight: 700;
    }
    .content {
      padding: 40px 30px;
    }
    .booking-details {
      background-color: #f8fafc;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      margin: 24px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #e2e8f0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      color: #64748b;
      font-weight: 600;
    }
    .detail-value {
      color: #1e293b;
      font-weight: 600;
      text-align: right;
      max-width: 60%;
    }
    .button {
      display: inline-block;
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: #ffffff !important;
      padding: 14px 32px;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 600;
      margin: 20px 0;
    }
    .alert {
      padding: 16px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .alert-info {
      background-color: #eff6ff;
      border: 2px solid #3b82f6;
      color: #1e40af;
    }
    .alert-success {
      background-color: #f0fdf4;
      border: 2px solid #10b981;
      color: #065f46;
    }
    .footer {
      background-color: #f8fafc;
      padding: 30px;
      text-align: center;
      color: #64748b;
      font-size: 14px;
    }
    .footer a {
      color: #3b82f6;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Markeb Media">
      <h1>Markeb Media</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>
        <strong>Markeb Media</strong><br>
        Professional Property Media, Marketing & Technology Solution<br>
        <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
      </p>
      <p style="margin-top: 20px; font-size: 12px; color: #94a3b8;">
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