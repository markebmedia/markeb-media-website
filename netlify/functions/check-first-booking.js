// netlify/functions/check-first-booking.js
// Called after any payment is confirmed — checks if this is the customer's
// first ever paid booking and if so, generates a free second shoot code

const Airtable = require('airtable');
const { Resend } = require('resend');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const LOGO_URL = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';

async function checkFirstBooking({ clientEmail, clientName, bookingRef, finalPrice }) {
  console.log(`=== Check First Booking: ${clientEmail} ===`);

  try {
    // 1. Count all paid, non-cancelled bookings for this email
    const paidBookings = await base('Bookings')
      .select({
        filterByFormula: `AND(
          LOWER({Client Email}) = "${clientEmail.toLowerCase()}",
          {Payment Status} = "Paid",
          {Booking Status} != "Cancelled"
        )`,
        fields: ['Booking Reference', 'Final Price', 'Client Email']
      })
      .all();

    console.log(`Paid bookings found for ${clientEmail}: ${paidBookings.length}`);

    // Only trigger on exactly the first paid booking
    if (paidBookings.length !== 1) {
      console.log('Not first booking — skipping free shoot offer');
      return { success: true, triggered: false };
    }

    // 2. Check we haven't already sent a code for this booking
    const discountTableId = process.env.AIRTABLE_DISCOUNT_CODES_TABL;
    const existingCode = await base(discountTableId)
      .select({
        filterByFormula: `{Notes} = "First booking offer - ${bookingRef}"`,
        fields: ['Code']
      })
      .firstPage();

    if (existingCode && existingCode.length > 0) {
      console.log('Code already generated for this booking — skipping');
      return { success: true, triggered: false, reason: 'already_sent' };
    }

    // 3. Generate unique discount code
    const codeRef = bookingRef.replace('BK-', '').slice(-6);
    const discountCode = `SECOND${codeRef}`;
    const codeValue = parseFloat(finalPrice.toFixed(2));

    console.log(`Generating free shoot code: ${discountCode} worth £${codeValue}`);

    // 4. Find the customer's Airtable user record ID
    let applicableCustomerIds = [];
    try {
      const userRecords = await base(process.env.AIRTABLE_USER_TABLE)
        .select({
          filterByFormula: `LOWER({Email}) = "${clientEmail.toLowerCase()}"`,
          fields: ['Email']
        })
        .firstPage();

      if (userRecords && userRecords.length > 0) {
        applicableCustomerIds = [userRecords[0].id];
        console.log(`Linked to user record: ${userRecords[0].id}`);
      }
    } catch (userError) {
      console.warn('Could not find user record — code will not be customer-restricted', userError.message);
    }

    // 5. Save the discount code to Airtable
    await base(discountTableId).create({
      'Code': discountCode,
      'Discount Type': 'Fixed Amount',
      'Discount Value': codeValue,
      'Status': 'Active',
      'Max Uses': 1,
      'Per Customer Limit': 1,
      'Times Used': 0,
      'Notes': `First booking offer - ${bookingRef}`,
      ...(applicableCustomerIds.length > 0 && {
        'Applicable Customers': applicableCustomerIds
      })
    });

    console.log(`✅ Discount code created in Airtable: ${discountCode}`);

    // 6. Send the branded email
    const firstName = (clientName || 'there').split(' ')[0];

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #3F4D1B; background-color: #f7ead5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background-color: #FDF3E2; }
    .header { background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%); padding: 40px 20px; text-align: center; }
    .header img { max-width: 200px; width: 100%; height: auto; margin-bottom: 20px; }
    .header h1 { color: #FDF3E2; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
    .header-accent { width: 40px; height: 3px; background: #B46100; margin: 14px auto 0; border-radius: 2px; }
    .hero { background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); padding: 40px 30px; text-align: center; }
    .hero h2 { color: #FDF3E2; font-size: 32px; font-weight: 700; margin: 0 0 12px; letter-spacing: -0.02em; }
    .hero p { color: rgba(253,243,226,0.9); font-size: 17px; margin: 0; }
    .content { padding: 40px 30px; }
    .content p { color: #3F4D1B; margin: 0 0 14px; font-size: 15px; }
    .code-box { background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%); border-radius: 16px; padding: 32px; margin: 28px 0; text-align: center; }
    .code-label { color: rgba(253,243,226,0.7); font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
    .code-value { color: #FDF3E2; font-size: 36px; font-weight: 700; letter-spacing: 4px; font-family: monospace; margin-bottom: 12px; }
    .code-worth { color: rgba(253,243,226,0.9); font-size: 16px; }
    .code-worth strong { color: #FDF3E2; }
    .how-to-use { background: #f7ead5; border: 2px solid #e8d9be; border-radius: 12px; padding: 24px; margin: 24px 0; }
    .how-to-use h3 { color: #3F4D1B; font-size: 16px; font-weight: 700; margin: 0 0 16px; }
    .step { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 14px; }
    .step:last-child { margin-bottom: 0; }
    .step-number { background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); color: #FDF3E2; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0; text-align: center; line-height: 28px; }
    .step-text { color: #3F4D1B; font-size: 14px; padding-top: 4px; }
    .alert-info { background: #fff8ee; border: 2px solid #B46100; border-radius: 12px; padding: 16px 20px; margin: 24px 0; color: #8a4a00; font-size: 14px; }
    .button-wrap { text-align: center; margin: 32px 0; }
    .button { display: inline-block; background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); color: #FDF3E2 !important; padding: 16px 40px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; }
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
    </div>

    <div class="hero">
      <h2>Your free shoot is ready.</h2>
      <p>Thank you for your first booking. Here's your reward.</p>
    </div>

    <div class="content">

      <p>Hi ${firstName},</p>
      <p>As promised, now that your first shoot is confirmed we're giving you a code for your next one completely free. It's worth the exact same value as your first booking.</p>

      <div class="code-box">
        <div class="code-label">Your Free Shoot Code</div>
        <div class="code-value">${discountCode}</div>
        <div class="code-worth">Worth <strong>£${codeValue.toFixed(2)}</strong> off your next booking</div>
      </div>

      <div class="how-to-use">
        <h3>How to use it</h3>
        <div class="step">
          <div class="step-number">1</div>
          <div class="step-text">Head to markebmedia.com and book your next shoot as normal</div>
        </div>
        <div class="step">
          <div class="step-number">2</div>
          <div class="step-text">Enter the code <strong>${discountCode}</strong> at checkout</div>
        </div>
        <div class="step">
          <div class="step-number">3</div>
          <div class="step-text">Your discount of £${codeValue.toFixed(2)} is applied automatically</div>
        </div>
      </div>

      <div class="alert-info">
        <strong>Good to know:</strong> This code is valid for one use and is linked to your account. It can be used on any service we offer. There is no expiry date.
      </div>

      <div class="button-wrap">
        <a href="https://markebmedia.com/website/booking.html" class="button">Book Your Next Shoot</a>
      </div>

      <p>If you have any questions just reply to this email and we'll help straight away.</p>
      <p>Thank you for choosing Markeb Media, ${firstName}.</p>
      <p>Best regards,<br><strong>Markeb Media</strong></p>

    </div>

    <div class="footer">
      <strong>Markeb Media</strong>
      <div class="footer-divider"></div>
      <p style="margin: 0 0 6px;">Professional Property Media, Marketing &amp; Technology</p>
      <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
    </div>

  </div>
</body>
</html>
    `;

    await resend.emails.send({
      from: FROM_EMAIL,
      to: clientEmail,
      bcc: 'commercial@markebmedia.com',
      subject: `Your free second shoot code is here, ${firstName} 🎁`,
      html: emailHtml
    });

    console.log(`✅ Free shoot code email sent to ${clientEmail}`);

    return {
      success: true,
      triggered: true,
      discountCode,
      codeValue
    };

  } catch (error) {
    console.error('❌ check-first-booking error:', error);
    return {
      success: false,
      triggered: false,
      error: error.message
    };
  }
}

// Allow calling as a Netlify function directly if needed
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const body = JSON.parse(event.body);
    const result = await checkFirstBooking(body);
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};

// Export so other functions can require() it
module.exports = { checkFirstBooking };