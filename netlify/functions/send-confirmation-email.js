const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const emailData = JSON.parse(event.body);

    // Validate required fields
    if (!emailData.to || !emailData.bookingRef || !emailData.bookingDetails) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required email data' })
      };
    }

    const { to, bookingRef, bookingDetails } = emailData;

    // Format date nicely
    const formatDate = (dateString) => {
      const date = new Date(dateString + 'T12:00:00');
      return date.toLocaleDateString('en-GB', { 
        weekday: 'long', 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      });
    };

    // Create email HTML
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Confirmation - Markeb Media</title>
  <style>
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #1e293b;
      background: #f8fafc;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      padding: 40px 30px;
      text-align: center;
    }
    .header img {
      height: 40px;
      margin-bottom: 20px;
    }
    .header h1 {
      color: #ffffff;
      margin: 0;
      font-size: 28px;
      font-weight: 700;
    }
    .success-icon {
      width: 60px;
      height: 60px;
      background: #10b981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 20px auto 0;
      font-size: 30px;
      color: #fff;
    }
    .content {
      padding: 40px 30px;
    }
    .booking-ref {
      background: #eff6ff;
      border: 2px solid #3b82f6;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      margin-bottom: 30px;
    }
    .booking-ref-label {
      font-size: 14px;
      color: #64748b;
      margin-bottom: 8px;
    }
    .booking-ref-value {
      font-size: 24px;
      font-weight: 700;
      color: #3b82f6;
    }
    .details-section {
      background: #f8fafc;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 30px;
    }
    .details-section h2 {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 16px 0;
      color: #1e293b;
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
      font-size: 14px;
    }
    .detail-value {
      color: #1e293b;
      font-weight: 600;
      font-size: 14px;
      text-align: right;
    }
    .next-steps {
      background: #f0fdf4;
      border: 2px solid #10b981;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 30px;
    }
    .next-steps h3 {
      font-size: 16px;
      font-weight: 700;
      color: #1e293b;
      margin: 0 0 12px 0;
    }
    .next-steps ol {
      margin: 0;
      padding-left: 20px;
      color: #64748b;
    }
    .next-steps li {
      margin-bottom: 8px;
      font-size: 14px;
    }
    .button {
      display: inline-block;
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: #ffffff;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      text-align: center;
      margin: 10px 0;
    }
    .footer {
      background: #f8fafc;
      padding: 30px;
      text-align: center;
      color: #64748b;
      font-size: 13px;
    }
    .footer a {
      color: #3b82f6;
      text-decoration: none;
    }
    @media only screen and (max-width: 600px) {
      .container {
        margin: 20px;
      }
      .content {
        padding: 30px 20px;
      }
      .detail-row {
        flex-direction: column;
        gap: 4px;
      }
      .detail-value {
        text-align: left;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <img src="https://cdn.prod.website-files.com/66e82259bc314e521e9902b0/66e82259bc314e521e990386_Markeb%20Media%20(4).svg" alt="Markeb Media" style="height: 40px;">
      <h1>Booking Confirmed</h1>
      <div class="success-icon">✓</div>
    </div>

    <!-- Content -->
    <div class="content">
      <p style="font-size: 16px; color: #64748b; margin-bottom: 30px;">
        Thank you for booking with Markeb Media! Your shoot has been confirmed and we're looking forward to creating stunning content for your property.
      </p>

      <!-- Booking Reference -->
      <div class="booking-ref">
        <div class="booking-ref-label">Your Booking Reference</div>
        <div class="booking-ref-value">${bookingRef}</div>
      </div>

      <!-- Booking Details -->
      <div class="details-section">
        <h2>Booking Details</h2>
        <div class="detail-row">
          <span class="detail-label">Service</span>
          <span class="detail-value">${bookingDetails.service}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Date</span>
          <span class="detail-value">${formatDate(bookingDetails.date)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Time</span>
          <span class="detail-value">${bookingDetails.time}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Location</span>
          <span class="detail-value">${bookingDetails.propertyAddress}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Photographer</span>
          <span class="detail-value">${bookingDetails.photographer}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Total</span>
          <span class="detail-value">£${bookingDetails.totalPrice.toFixed(2)}</span>
        </div>
      </div>

      <!-- Next Steps -->
      <div class="next-steps">
        <h3>What Happens Next?</h3>
        <ol>
          <li>You'll receive a reminder 24 hours before your shoot</li>
          <li>Your photographer will arrive at the scheduled time</li>
          <li>All content will be professionally edited and delivered within 48 hours</li>
          <li>Files will be shared via a secure Dropbox link</li>
        </ol>
      </div>

      <p style="font-size: 14px; color: #64748b; margin-bottom: 20px;">
        If you need to reschedule or have any questions, please don't hesitate to contact us.
      </p>

      <center>
        <a href="mailto:commercial@markebmedia.com" class="button">Contact Us</a>
      </center>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p style="margin-bottom: 10px;">
        <strong>Markeb Media</strong><br>
        Professional Property Photography
      </p>
      <p>
        <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a><br>
        <a href="https://markebmedia.com">www.markebmedia.com</a>
      </p>
    </div>
  </div>
</body>
</html>
    `;

    // Plain text version
    const emailText = `
BOOKING CONFIRMED

Thank you for booking with Markeb Media!

Your Booking Reference: ${bookingRef}

BOOKING DETAILS:
- Service: ${bookingDetails.service}
- Date: ${formatDate(bookingDetails.date)}
- Time: ${bookingDetails.time}
- Location: ${bookingDetails.propertyAddress}
- Photographer: ${bookingDetails.photographer}
- Total: £${bookingDetails.totalPrice.toFixed(2)}

WHAT HAPPENS NEXT:
1. You'll receive a reminder 24 hours before your shoot
2. Your photographer will arrive at the scheduled time
3. All content will be professionally edited and delivered within 48 hours
4. Files will be shared via a secure Dropbox link

If you need to reschedule or have any questions, please contact us at commercial@markebmedia.com

Best regards,
Markeb Media
www.markebmedia.com
    `;

    // Send email via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Markeb Media <bookings@markebmedia.com>',
        to: [to],
        subject: `Booking Confirmed - ${bookingRef}`,
        html: emailHtml,
        text: emailText
      })
    });

    if (!resendResponse.ok) {
      const error = await resendResponse.json();
      console.error('Resend error:', error);
      throw new Error('Failed to send email');
    }

    const resendData = await resendResponse.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        emailId: resendData.id,
        message: 'Confirmation email sent successfully'
      })
    };

  } catch (error) {
    console.error('Error sending email:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to send email'
      })
    };
  }
};