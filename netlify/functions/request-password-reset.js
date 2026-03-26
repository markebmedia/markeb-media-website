// netlify/functions/request-password-reset.js
const Airtable = require('airtable');
const { Resend } = require('resend');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const resend = new Resend(process.env.RESEND_API_KEY);

function generateResetCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

const resetAttempts = new Map();

function checkRateLimit(email) {
  const now = Date.now();
  const attempts = resetAttempts.get(email) || [];
  const recentAttempts = attempts.filter(timestamp => now - timestamp < 3600000);
  if (recentAttempts.length >= 3) {
    return false;
  }
  recentAttempts.push(now);
  resetAttempts.set(email, recentAttempts);
  return true;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers, 
      body: JSON.stringify({ message: 'Method not allowed' }) 
    };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');

    if (!email) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ message: 'Email is required' }) 
      };
    }

    if (!validateEmail(email)) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ message: 'Invalid email format' }) 
      };
    }

    if (!checkRateLimit(email.toLowerCase())) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ 
          message: 'Too many reset requests. Please try again later.' 
        })
      };
    }

    const records = await base('Markeb Media Users').select({
      filterByFormula: `LOWER({Email}) = "${email.toLowerCase()}"`,
      maxRecords: 1
    }).firstPage();

    if (records.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          message: 'If this email exists, a reset code has been sent.',
          success: true 
        })
      };
    }

    const user = records[0];
    const resetCode = generateResetCode();
    const expiryTime = new Date(Date.now() + 30 * 60 * 1000);

    await base('Markeb Media Users').update(user.id, {
      'Reset Token': resetCode,
      'Reset Token Expiry': expiryTime.toISOString()
    });

    await resend.emails.send({
  from: process.env.RESEND_FROM_EMAIL,
  to: email.toLowerCase(),
  subject: 'Password Reset Code - Markeb Media',
  html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f7ead5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 0; text-align: center; background-color: #f7ead5;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #FDF3E2; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(63,77,27,0.12);">

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%);">
              <div style="font-size: 40px; margin-bottom: 12px;">🔐</div>
              <h1 style="margin: 0; color: #FDF3E2; font-size: 28px; font-weight: 600; letter-spacing: -0.02em;">Password Reset</h1>
              <p style="margin: 10px 0 0; color: rgba(253,243,226,0.8); font-size: 15px;">We received a reset request for your account</p>
              <div style="width: 40px; height: 3px; background: #B46100; margin: 16px auto 0; border-radius: 2px;"></div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Hello ${user.fields.Name || 'User'},</p>

              <p style="margin: 0 0 25px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">
                Your password reset code is below. Enter it to continue resetting your password.
              </p>

              <!-- Reset Code Box -->
              <div style="background-color: #fff8ee; border: 2px solid #B46100; border-radius: 12px; padding: 32px 24px; text-align: center; margin: 0 0 24px;">
                <div style="font-size: 12px; color: #8a4a00; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px;">Your Reset Code</div>
                <div style="font-size: 42px; font-weight: 700; color: #B46100; letter-spacing: 10px; line-height: 1;">${resetCode}</div>
                <div style="margin-top: 16px; font-size: 13px; color: #8a4a00;">⏱ Expires in <strong>30 minutes</strong></div>
              </div>

              <!-- Warning -->
              <div style="padding: 16px; background-color: #f3f7e8; border: 2px solid #3F4D1B; border-radius: 8px; margin: 0 0 25px;">
                <p style="margin: 0; font-size: 14px; color: #3F4D1B; line-height: 1.6;">
                  <strong>Didn't request this?</strong> You can safely ignore this email. Your password will not be changed unless you enter this code.
                </p>
              </div>

              <p style="margin: 0; color: #6b7c2e; font-size: 14px; line-height: 1.6;">
                Need help? Contact us at <a href="mailto:commercial@markebmedia.com" style="color: #B46100; text-decoration: none;">commercial@markebmedia.com</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #3F4D1B;">
              <p style="margin: 0 0 4px; color: #FDF3E2; font-size: 14px; font-weight: 600;">Best regards,</p>
              <p style="margin: 0; color: rgba(253,243,226,0.75); font-size: 14px;">The Markeb Media Team</p>
              <div style="width: 32px; height: 2px; background: #B46100; margin: 16px 0; border-radius: 1px;"></div>
              <p style="margin: 0; color: rgba(253,243,226,0.4); font-size: 12px; line-height: 1.5;">Professional Property Media, Marketing &amp; Technology Solution</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `
});

    console.log('Reset email sent successfully to:', email);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Reset code sent to your email.',
        success: true 
      })
    };

  } catch (error) {
    console.error('Request password reset error:', error.message, error.stack);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ 
        message: 'An error occurred. Please try again later.' 
      }) 
    };
  }
};