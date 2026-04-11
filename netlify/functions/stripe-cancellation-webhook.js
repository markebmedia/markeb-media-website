// netlify/functions/stripe-cancellation-webhook.js
// Processes cancellation fee payments from cancel-booking-with-payment.js

const Airtable = require('airtable');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method not allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_CANCELLATION_WEBHOOK_SECRET;

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return { statusCode: 400, headers, body: `Webhook Error: ${err.message}` };
  }

  // Handle checkout.session.completed event
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    try {
      const { bookingId, bookingRef, cancellationType, cancellationReason, cancellationFee, originalTotalPrice } = session.metadata;

      console.log(`Processing cancellation payment for booking ${bookingRef}`);

      const cancellationFeeAmount = parseFloat(cancellationFee);
      const totalPrice = parseFloat(originalTotalPrice);
      const refundAmount = totalPrice - cancellationFeeAmount;
      const cancellationChargePercentage = (cancellationFeeAmount / totalPrice) * 100;

      // Update booking status to Cancelled in Airtable
      await base('Bookings').update(bookingId, {
        'Booking Status': 'Cancelled',
        'Cancellation Date': new Date().toISOString().split('T')[0],
        'Cancellation Paid': true,
        'Cancellation Payment ID': session.payment_intent,
        'Cancellation Pending': false,
        'Cancellation Charge %': Math.round(cancellationChargePercentage),
        'Cancellation Charge': cancellationFeeAmount,
        'Refund Amount': refundAmount
      });

      console.log(`✅ Booking ${bookingRef} cancelled successfully`);

      // Fetch full booking details for email
      const booking = await base('Bookings').find(bookingId);
      const fields = booking.fields;

      // Send cancellation confirmation email
      if (process.env.RESEND_API_KEY) {
        try {
          const { Resend } = require('resend');
          const resend = new Resend(process.env.RESEND_API_KEY);

          const SPECIALIST_EMAILS = {
            'James Jago': 'James.Jago@markebmedia.com',
            'Andrii':     'Andrii.Hutovych@markebmedia.com'
          };

          const cancellationBcc = ['commercial@markebmedia.com'];
          if (fields['Media Specialist'] && SPECIALIST_EMAILS[fields['Media Specialist']]) {
            cancellationBcc.push(SPECIALIST_EMAILS[fields['Media Specialist']]);
          }

          await resend.emails.send({
  from: 'Markeb Media <commercial@markebmedia.com>',
  to: fields['Client Email'],
  bcc: cancellationBcc,
  subject: `Booking Cancelled - ${bookingRef}`,
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
              <h1 style="margin: 0; color: #FDF3E2; font-size: 28px; font-weight: 600; letter-spacing: -0.02em;">Booking Cancelled</h1>
              <p style="margin: 10px 0 0; color: rgba(253,243,226,0.8); font-size: 15px;">Your cancellation has been processed</p>
              <div style="width: 40px; height: 3px; background: #B46100; margin: 16px auto 0; border-radius: 2px;"></div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Hi ${fields['Client Name']},</p>
              <p style="margin: 0 0 25px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Your booking has been cancelled and the cancellation fee has been processed.</p>

              <!-- Booking Details -->
              <div style="background-color: #f7ead5; border: 2px solid #e8d9be; border-radius: 12px; padding: 24px; margin: 0 0 20px;">
                <h3 style="margin: 0 0 16px; color: #3F4D1B; font-size: 16px; font-weight: 700;">Cancelled Booking Details</h3>
                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600; width: 40%;">Reference</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${bookingRef}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600;">Service</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${fields['Service']}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600;">Date &amp; Time</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${new Date(fields['Date']).toLocaleDateString('en-GB')} at ${fields['Time']}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7c2e; font-size: 14px; font-weight: 600;">Property</td>
                    <td style="padding: 10px 0; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${fields['Property Address']}</td>
                  </tr>
                </table>
              </div>

              <!-- Cancellation Fee -->
              <div style="padding: 16px; background-color: #fff8ee; border: 2px solid #B46100; border-radius: 8px; margin: 0 0 20px;">
                <p style="margin: 0 0 6px; color: #8a4a00; font-size: 15px; font-weight: 700;">⚠️ Cancellation Fee</p>
                <p style="margin: 0 0 4px; color: #8a4a00; font-size: 14px; line-height: 1.6;"><strong>${cancellationType}:</strong> £${cancellationFeeAmount.toFixed(2)}</p>
                <p style="margin: 0; color: #8a4a00; font-size: 13px;">This fee has been charged to your payment method.</p>
              </div>

              ${refundAmount > 0 ? `
              <!-- Refund -->
              <div style="padding: 16px; background-color: #f3f7e8; border: 2px solid #3F4D1B; border-radius: 8px; margin: 0 0 20px;">
                <p style="margin: 0 0 6px; color: #3F4D1B; font-size: 15px; font-weight: 700;">✅ Refund Information</p>
                <p style="margin: 0; color: #6b7c2e; font-size: 14px; line-height: 1.6;">A refund of <strong>£${refundAmount.toFixed(2)}</strong> will be processed to your original payment method within 5–7 business days.</p>
              </div>
              ` : ''}

              ${cancellationReason && cancellationReason !== 'No reason provided' ? `
              <!-- Reason -->
              <div style="padding: 16px; background-color: #f7ead5; border: 2px solid #e8d9be; border-radius: 8px; margin: 0 0 20px;">
                <p style="margin: 0 0 4px; color: #6b7c2e; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Cancellation Reason</p>
                <p style="margin: 0; color: #3F4D1B; font-size: 14px; line-height: 1.6;">${cancellationReason}</p>
              </div>
              ` : ''}

              <p style="margin: 0 0 20px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">If you'd like to book again in the future, we'd be happy to help you schedule a new shoot.</p>

              <!-- CTA Button -->
              <table role="presentation" style="margin: 0 0 24px;">
                <tr>
                  <td>
                    <a href="https://markebmedia.com/booking.html" style="display: inline-block; background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); color: #FDF3E2; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px;">Book a New Shoot</a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; color: #6b7c2e; font-size: 14px; line-height: 1.6;">Questions? Contact us at <a href="mailto:commercial@markebmedia.com" style="color: #B46100; text-decoration: none;">commercial@markebmedia.com</a></p>
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

          console.log(`✅ Cancellation email sent to ${fields['Client Email']}`);
        } catch (emailError) {
          console.error('⚠️ Failed to send cancellation email:', emailError);
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ received: true, status: 'Cancellation processed' })
      };

    } catch (error) {
      console.error('❌ Error processing cancellation webhook:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to process cancellation', details: error.message })
      };
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ received: true })
  };
};