// netlify/functions/process-reserved-payment.js
// Admin function to process payment for a reserved booking
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const { bookingId, bookingRef } = JSON.parse(event.body);

    if (!bookingId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Booking ID required' })
      };
    }

    // Fetch booking details from Airtable
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
    
    const booking = await base('Bookings').find(bookingId);
    const fields = booking.fields;

    // ✅ FIXED: Check Booking Status (not Payment Status)
    if (fields['Booking Status'] !== 'Reserved') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'This booking is not in Reserved status' 
        })
      };
    }

    // Create Stripe payment link
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: fields['Service'] || 'Property Photography', // ✅ FIXED: Was 'Service Name'
              description: `Booking ${fields['Booking Reference']} - ${fields['Date']} at ${fields['Time']}`
            },
            unit_amount: Math.round(fields['Total Price'] * 100) // Convert to pence
          },
          quantity: 1
        }
      ],
      after_completion: {
        type: 'redirect',
        redirect: {
          url: `https://markebmedia.com/booking-success?ref=${fields['Booking Reference']}`
        }
      },
      metadata: {
        bookingId: bookingId,
        bookingRef: fields['Booking Reference'],
        clientEmail: fields['Client Email'],
        type: 'reserved_booking_payment'
      }
    });

    // Send payment link to customer via email
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
  from: 'Markeb Media <commercial@markebmedia.com>',
  to: fields['Client Email'],
  bcc: 'commercial@markebmedia.com',
  subject: `Payment Required - ${fields['Booking Reference']}`,
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
              <div style="font-size: 40px; margin-bottom: 12px;">💳</div>
              <h1 style="margin: 0; color: #FDF3E2; font-size: 28px; font-weight: 600; letter-spacing: -0.02em;">Payment Required</h1>
              <p style="margin: 10px 0 0; color: rgba(253,243,226,0.8); font-size: 15px;">Your booking is ready for payment</p>
              <div style="width: 40px; height: 3px; background: #B46100; margin: 16px auto 0; border-radius: 2px;"></div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Hi <strong>${fields['Client Name']}</strong>,</p>

              <p style="margin: 0 0 25px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">
                Thank you for choosing Markeb Media! Your booking has been reserved and is ready for payment. Please complete payment using the secure link below to confirm your booking.
              </p>

              <!-- Booking Details -->
              <div style="background-color: #f7ead5; border: 2px solid #e8d9be; border-radius: 12px; padding: 24px; margin: 0 0 24px;">
                <h3 style="margin: 0 0 16px; color: #3F4D1B; font-size: 16px; font-weight: 700;">📋 Booking Details</h3>
                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600; width: 40%;">Reference</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${fields['Booking Reference']}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600;">Service</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${fields['Service']}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600;">Date</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${fields['Date']}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600;">Time</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${fields['Time']}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7c2e; font-size: 14px; font-weight: 600;">Property</td>
                    <td style="padding: 10px 0; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${fields['Property Address'] || 'N/A'}</td>
                  </tr>
                </table>
              </div>

              <!-- Amount Due -->
              <div style="background-color: #fff8ee; border: 2px solid #B46100; border-radius: 12px; padding: 24px; text-align: center; margin: 0 0 24px;">
                <div style="font-size: 12px; color: #8a4a00; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Total Amount Due</div>
                <div style="font-size: 48px; font-weight: 700; color: #B46100; line-height: 1; margin: 0;">£${fields['Total Price'].toFixed(2)}</div>
              </div>

              <!-- CTA Button -->
              <table role="presentation" style="margin: 0 auto 24px;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${paymentLink.url}" style="display: inline-block; background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); color: #FDF3E2; text-decoration: none; padding: 18px 40px; border-radius: 10px; font-weight: 600; font-size: 18px;">
                      💳 Pay Now — £${fields['Total Price'].toFixed(2)}
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Warning -->
              <div style="padding: 16px; background-color: #fff8ee; border: 2px solid #B46100; border-radius: 8px; margin: 0 0 25px;">
                <p style="margin: 0; font-size: 14px; color: #8a4a00; line-height: 1.6;">
                  <strong>⚠️ Important:</strong> Your booking will remain in reserved status until payment is completed. Please complete payment as soon as possible to confirm your booking.
                </p>
              </div>

              <p style="margin: 0 0 6px; color: #6b7c2e; font-size: 15px; line-height: 1.6;">
                If you have any questions or need assistance, please contact us at <a href="mailto:commercial@markebmedia.com" style="color: #B46100; text-decoration: none;">commercial@markebmedia.com</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #3F4D1B;">
              <p style="margin: 0 0 4px; color: #FDF3E2; font-size: 14px; font-weight: 600;">Best regards,</p>
              <p style="margin: 0; color: rgba(253,243,226,0.75); font-size: 14px;">The Markeb Media Team</p>
              <div style="width: 32px; height: 2px; background: #B46100; margin: 16px 0; border-radius: 1px;"></div>
              <p style="margin: 0 0 4px; color: rgba(253,243,226,0.5); font-size: 12px;">Professional Property Media, Marketing &amp; Technology Solution</p>
              <p style="margin: 0; color: rgba(253,243,226,0.3); font-size: 12px;">This is an automated email. Please do not reply directly to this message.</p>
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

    // Update booking with payment link info
    await base('Bookings').update(bookingId, {
      'Payment Link': paymentLink.url,
      'Payment Link Created': new Date().toISOString()
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Payment link sent to customer',
        paymentLink: paymentLink.url
      })
    };

  } catch (error) {
    console.error('Error processing payment:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
};