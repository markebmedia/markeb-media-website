// netlify/functions/submit-contact.js

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const SITE_URL   = 'https://markebmedia.com';
const LOGO_URL   = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';

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
    .container { max-width: 600px; margin: 0 auto; background-color: #FDF3E2; }
    .header {
      background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%);
      padding: 40px 20px;
      text-align: center;
    }
    .header img { max-width: 200px; width: 100%; height: auto; margin-bottom: 20px; }
    .header h1 { color: #FDF3E2; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
    .header-accent { width: 40px; height: 3px; background: #B46100; margin: 14px auto 0; border-radius: 2px; }
    .content { padding: 40px 30px; }
    .content h2 { color: #3F4D1B; font-size: 22px; font-weight: 700; margin: 0 0 8px; }
    .content h3 { color: #3F4D1B; font-size: 16px; font-weight: 700; margin: 24px 0 8px; }
    .content p { color: #3F4D1B; margin: 0 0 14px; }
    .content ul { color: #3F4D1B; padding-left: 20px; margin: 0 0 14px; }
    .content ul li { margin-bottom: 6px; }
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
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #6b7c2e; font-weight: 600; font-size: 14px; }
    .detail-value { color: #3F4D1B; font-weight: 600; text-align: right; max-width: 60%; font-size: 14px; }
    .message-box {
      background: #ffffff;
      border: 1px solid #e8d9be;
      border-left: 3px solid #B46100;
      border-radius: 0 8px 8px 0;
      padding: 20px 24px;
      margin: 16px 0 24px;
      font-size: 15px;
      color: #3F4D1B;
      line-height: 1.7;
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
    .alert { padding: 16px; border-radius: 8px; margin: 20px 0; font-size: 14px; }
    .alert-info { background-color: #fff8ee; border: 2px solid #B46100; color: #8a4a00; }
    .alert-success { background-color: #f3f7e8; border: 2px solid #3F4D1B; color: #3F4D1B; }
    .footer {
      background-color: #3F4D1B;
      padding: 30px;
      text-align: center;
      color: rgba(253,243,226,0.7);
      font-size: 14px;
    }
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
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <strong>Markeb Media</strong>
      <div class="footer-divider"></div>
      <p style="margin:0 0 6px;">Professional Property Media, Marketing &amp; Technology Solutions</p>
      <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
      <p style="margin-top:20px;font-size:12px;color:rgba(253,243,226,0.4);">
        <a href="${SITE_URL}">markebmedia.com</a>
      </p>
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
    const { name, email, agency, phone, message } = JSON.parse(event.body);

    if (!name || !email || !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Name, email and message are required.' })
      };
    }

    // ── Internal notification to the Markeb Media team ──
    const internalContent = `
      <h2>📩 New Website Enquiry</h2>
      <p>A new message has been submitted via the Markeb Media website contact form.</p>

      <div class="booking-details">
        <div class="detail-row">
          <span class="detail-label">Name</span>
          <span class="detail-value">${name}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Email</span>
          <span class="detail-value"><a href="mailto:${email}" style="color:#B46100;">${email}</a></span>
        </div>
        ${agency ? `
        <div class="detail-row">
          <span class="detail-label">Agency / Company</span>
          <span class="detail-value">${agency}</span>
        </div>` : ''}
        ${phone ? `
        <div class="detail-row">
          <span class="detail-label">Phone</span>
          <span class="detail-value">${phone}</span>
        </div>` : ''}
      </div>

      <h3>Message</h3>
      <div class="message-box">${message.replace(/\n/g, '<br>')}</div>

      <center>
        <a href="mailto:${email}" class="button">Reply to ${name}</a>
      </center>

      <div class="alert alert-info">
        <strong>⏱ Response Target</strong><br>
        Please aim to respond to this enquiry within 24 hours.
      </div>
    `;

    await resend.emails.send({
      from: FROM_EMAIL,
      to: ['Jodie.Hamshaw@markebmedia.com', 'commercial@markebmedia.com'],
      replyTo: email,
      subject: `New Enquiry: ${name}${agency ? ` — ${agency}` : ''}`,
      html: getEmailLayout(internalContent)
    });

    // ── Auto-reply to the person who submitted ──
    const autoReplyContent = `
      <h2>Thanks for reaching out, ${name.split(' ')[0]}.</h2>
      <p>We have received your message and a member of our team will be in touch within 24 hours.</p>

      <div class="alert alert-success">
        <strong>✅ Message Received</strong><br>
        We will review your enquiry and get back to you as soon as possible.
      </div>

      <h3>What Happens Next?</h3>
      <p>One of our team will review your message and reach out directly. In the meantime, feel free to explore what we do:</p>
      <ul>
        <li>Browse our <a href="${SITE_URL}/portfolio" style="color:#B46100;">portfolio</a></li>
        <li>Learn more about our <a href="${SITE_URL}#services" style="color:#B46100;">services</a></li>
        <li>Email us directly at <a href="mailto:commercial@markebmedia.com" style="color:#B46100;">commercial@markebmedia.com</a></li>
      </ul>

      <h3>Your Message</h3>
      <div class="message-box">${message.length > 300 ? message.substring(0, 300) + '...' : message}</div>

      <p style="margin-top:24px;">Best regards,<br><strong>The Markeb Media Team</strong></p>
    `;

    await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: 'We have received your message — Markeb Media',
      html: getEmailLayout(autoReplyContent)
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true })
    };

  } catch (error) {
    console.error('Contact form error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to send message.' })
    };
  }
};