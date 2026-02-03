// netlify/functions/send-progress-update.js
// Sends progress update emails when Active Bookings status changes
// Triggered by Airtable automation webhook

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const BCC_EMAIL = 'commercial@markebmedia.com';
const SITE_URL = 'https://markebmedia.com';
const LOGO_URL = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';
const DASHBOARD_URL = 'https://markebmedia.com/login';

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const payload = JSON.parse(event.body);
    
    // Extract data from Airtable webhook payload
    const { status, customerName, trackingCode, deliveryLink, email, projectAddress } = payload;

    if (!status || !customerName || !trackingCode || !email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Missing required fields',
          required: ['status', 'customerName', 'trackingCode', 'email']
        })
      };
    }

    console.log(`Sending progress update email for status: ${status} to ${email}`);

    // Send appropriate email based on status
    let emailSent = false;

    switch (status) {
      case 'Editing':
        await sendEditingEmail(customerName, trackingCode, projectAddress, email);
        emailSent = true;
        break;

      case 'Quality Control':
        await sendQualityControlEmail(customerName, trackingCode, projectAddress, email);
        emailSent = true;
        break;

      case 'Ready for Delivery':
        if (!deliveryLink) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Delivery link required for Ready for Delivery status' })
          };
        }
        await sendReadyForDeliveryEmail(customerName, trackingCode, deliveryLink, projectAddress, email);
        emailSent = true;
        break;

      default:
        console.log(`No email template for status: ${status}`);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: true,
            message: `No email configured for status: ${status}` 
          })
        };
    }

    if (emailSent) {
      console.log(`✅ Progress update email sent successfully to ${email}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Email sent for status: ${status}`,
        recipient: email
      })
    };

  } catch (error) {
    console.error('Error sending progress update email:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to send email',
        details: error.message 
      })
    };
  }
};

// Email Layout Wrapper
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
      background-color: #3b82f6;
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
    .button {
      display: inline-block;
      background-color: #3b82f6;
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: #ffffff !important;
      padding: 14px 32px;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 600;
      margin: 20px 0;
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

// 1. Editing Status Email
async function sendEditingEmail(customerName, trackingCode, projectAddress, email) {
  const content = `
    <h2>📸 Your Content is Being Edited</h2>
    <p>Hi ${customerName},</p>
    
    <p>We are pleased to let you know that we are currently editing the content for <strong>${projectAddress}</strong>.</p>
    
    <p>Our team is meticulously enhancing your visuals to ensure they reflect the property in the best possible light — sharp, refined, and market-ready.</p>
    
    <p><strong>You're one step closer to getting ${projectAddress} on the market.</strong></p>
    
    <p>As an added benefit, you can track every stage of your marketing through your personalised dashboard giving you complete visibility from shoot to delivery:</p>
    
    <center>
      <a href="${DASHBOARD_URL}" class="button">Track Your Project</a>
    </center>
    
    <div class="alert alert-info">
      <strong>📍 Your Tracking Code:</strong><br>
      <span style="font-size: 18px; font-weight: bold;">${trackingCode}</span>
    </div>
    
    <p>Questions about your marketing? Reply anytime we're always here to help.</p>
    
    <p>Warm regards,<br><strong>Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    bcc: BCC_EMAIL,
    subject: `Your Content is Being Edited - ${projectAddress}`,
    html: emailHtml
  });
}

// 2. Quality Control Status Email
async function sendQualityControlEmail(customerName, trackingCode, projectAddress, email) {
  const content = `
    <h2>🔍 Your Content is in Quality Control</h2>
    <p>Hi ${customerName},</p>
    
    <p>We are pleased to let you know that we are currently performing the final quality control on the content for <strong>${projectAddress}</strong>.</p>
    
    <p>Our team is thoroughly reviewing every detail to ensure your content is flawless, on-brand, and ready for delivery.</p>
    
    <p><strong>${projectAddress} is just one step away from going live on the market!</strong></p>
    
    <p>You have exclusive access to your personalised dashboard where you can track your marketing progress, request revisions, and view your content calendar:</p>
    
    <center>
      <a href="${DASHBOARD_URL}" class="button">Track Your Project</a>
    </center>
    
    <div class="alert alert-info">
      <strong>📍 Your Tracking Code:</strong><br>
      <span style="font-size: 18px; font-weight: bold;">${trackingCode}</span>
    </div>
    
    <p>Questions about your marketing? Reply anytime we're always here to help.</p>
    
    <p>Warm regards,<br><strong>Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    bcc: BCC_EMAIL,
    subject: `Your Content is in Quality Control - ${projectAddress}`,
    html: emailHtml
  });
}

// 3. Ready for Delivery Status Email
async function sendReadyForDeliveryEmail(customerName, trackingCode, deliveryLink, projectAddress, email) {
  const content = `
    <h2>🎉 Your Content is Now Ready!</h2>
    <p>Hi ${customerName},</p>
    
    <p>Your content for <strong>${projectAddress}</strong> is now ready 🎉</p>
    
    <div class="alert alert-success">
      <strong>📥 Download Link:</strong><br>
      <a href="${deliveryLink}" style="color: #065f46; font-weight: bold; font-size: 16px;">${deliveryLink}</a>
    </div>
    
    <div class="alert alert-info">
      <strong>📍 Tracking Code:</strong> ${trackingCode}
    </div>
    
    <p><strong>✏️ Need tweaks?</strong> You have exclusive access to your client dashboard where you can request revisions, track your project live, and manage your content.</p>
    
    <center>
      <a href="${DASHBOARD_URL}" class="button">Access Your Dashboard</a>
    </center>
    
    <p>We're happy to help.</p>
    
    <p>Thanks again for choosing Markeb Media — if you need anything else, don't hesitate to get in touch.</p>
    
    <p>Kind regards,<br><strong>Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    bcc: BCC_EMAIL,
    subject: `Your Content is Ready! - ${projectAddress}`,
    html: emailHtml
  });
}