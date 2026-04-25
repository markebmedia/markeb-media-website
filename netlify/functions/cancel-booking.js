// netlify/functions/cancel-booking.js
const Airtable = require('airtable');
const Stripe = require('stripe');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

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
    const { bookingId, clientEmail, reason } = JSON.parse(event.body);

    if (!bookingId || !clientEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Booking ID and email are required' })
      };
    }

    console.log(`Processing free cancellation for booking ${bookingId}`);

    // Fetch the booking
    const booking = await base('Bookings').find(bookingId);
    const fields = booking.fields;

    // Verify email matches
    if (fields['Client Email'] !== clientEmail) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Email does not match booking' })
      };
    }

    // Check if already cancelled
    if (fields['Booking Status'] === 'Cancelled') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Booking is already cancelled' })
      };
    }

    // Check 24-hour cancellation policy
    const bookingDateTime = new Date(`${fields['Date']}T${fields['Time']}:00`);
    const now = new Date();
    const hoursUntil = (bookingDateTime - now) / (1000 * 60 * 60);

    if (hoursUntil < 24) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Cancellations within 24 hours require a fee. Please use the paid cancellation option.',
          hoursUntil: Math.round(hoursUntil)
        })
      };
    }

    // Calculate refund details
    const totalPrice = fields['Final Price'] || 0;
    const cancellationCharge = 0; // Free cancellation
    const cancellationChargePercentage = 0;
    const refundAmount = totalPrice;

    // Process Stripe refund if booking was paid
    if (fields['Payment Status'] === 'Paid' && fields['Stripe Payment Intent ID']) {
      try {
        const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
        const refund = await stripe.refunds.create({
          payment_intent: fields['Stripe Payment Intent ID'],
          reason: 'requested_by_customer'
        });
        console.log(`✅ Stripe refund created: ${refund.id} for £${totalPrice}`);
      } catch (stripeError) {
        console.error('Stripe refund failed:', stripeError);
        throw new Error(`Refund failed: ${stripeError.message}`);
      }
    } else if (fields['Payment Status'] === 'Paid') {
      console.warn('⚠️ Booking is Paid but no Stripe Payment Intent ID found — manual refund required');
    }

    // Update booking status in Airtable
    await base('Bookings').update(bookingId, {
      'Booking Status': 'Cancelled',
      'Cancellation Date': new Date().toISOString().split('T')[0],
      'Cancellation Reason': reason || 'Customer requested',
      'Cancellation Charge %': cancellationChargePercentage,
      'Cancellation Fee': cancellationCharge,
      'Cancellation Fee Ex VAT': 0,
      'Cancellation VAT Amount': 0,
      'Refund Amount': refundAmount,
      'Cancelled By': 'Client'
    });

    console.log(`✅ Booking ${fields['Booking Reference']} cancelled (free)`);

    // ✅ NEW: Move Active Booking from Active Bookings to Cancelled Bookings table
    try {
      const bookingRef = fields['Booking Reference'];
      
      // Find the Active Booking record by Booking ID
      const activeBookings = await base('tblRgcv7M9dUU3YuL')
        .select({
          filterByFormula: `{Booking ID} = '${bookingRef}'`,
          maxRecords: 1
        })
        .firstPage();

      if (activeBookings && activeBookings.length > 0) {
        const activeBooking = activeBookings[0];
        const activeBookingData = activeBooking.fields;
        
        // Create record in Cancelled Bookings table (copy all fields)
        await base('Cancelled Bookings').create({
          'Project Address': activeBookingData['Project Address'],
          'Customer Name': activeBookingData['Customer Name'],
          'Service Type': activeBookingData['Service Type'],
          'Shoot Date': activeBookingData['Shoot Date'],
          'Status': 'Cancelled',
          'Email': activeBookingData['Email Address'],
          'Phone Number': activeBookingData['Phone Number'],
          'Booking ID': activeBookingData['Booking ID'],
          'Region': activeBookingData['Region'],
          'Media Specialist': activeBookingData['Media Specialist'],
          'Cancellation Date': new Date().toISOString().split('T')[0],
          'Cancellation Reason': reason || 'Customer requested'
        });
        
        console.log(`✓ Booking moved to Cancelled Bookings table`);
        
        // Delete from Active Bookings table
        await base('tblRgcv7M9dUU3YuL').destroy(activeBooking.id);
        console.log(`✓ Booking removed from Active Bookings table`);
        
      } else {
        console.log(`⚠️ No Active Booking found for ${bookingRef}`);
      }
    } catch (activeBookingError) {
      console.error('Error moving Active Booking to Cancelled:', activeBookingError);
      // Don't fail the cancellation if Active Booking move fails
    }

    // Determine refund note
    let refundNote = '';
    if (fields['Payment Status'] === 'Paid') {
      refundNote = 'A full refund will be processed to your original payment method within 5-7 business days.';
    } else {
      refundNote = 'Your reservation has been released.';
    }

    // Send cancellation confirmation email
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        // ✅ Determine BCC recipients based on region
        const bccRecipients = ['commercial@markebmedia.com'];
        
        const SPECIALIST_EMAILS = {
          'James Jago': 'James.Jago@markebmedia.com',
          'Andrii':     'Andrii.Hutovych@markebmedia.com'
        };

        if (fields['Media Specialist'] && SPECIALIST_EMAILS[fields['Media Specialist']]) {
          bccRecipients.push(SPECIALIST_EMAILS[fields['Media Specialist']]);
          console.log(`✓ BCC: Adding ${fields['Media Specialist']}`);
        }

        await resend.emails.send({
  from: 'Markeb Media <commercial@markebmedia.com>',
  to: clientEmail,
  bcc: bccRecipients,
  subject: `Booking Cancelled - ${fields['Booking Reference']}`,
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
              <h1 style="margin: 0; color: #FDF3E2; font-size: 26px; font-weight: 600; letter-spacing: -0.02em;">Booking Cancelled</h1>
              <p style="margin: 10px 0 0; color: rgba(253,243,226,0.8); font-size: 15px;">We've processed your cancellation</p>
              <div style="width: 40px; height: 3px; background: #B46100; margin: 16px auto 0; border-radius: 2px;"></div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Hi ${fields['Client Name']},</p>
              <p style="margin: 0 0 25px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Your booking has been successfully cancelled.</p>

              <!-- Booking Details -->
              <div style="background-color: #f7ead5; border: 2px solid #e8d9be; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <h3 style="margin: 0 0 16px; color: #3F4D1B; font-size: 16px; font-weight: 700;">Cancelled Booking Details</h3>
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
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600;">Date &amp; Time</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${new Date(fields['Date']).toLocaleDateString('en-GB')} at ${fields['Time']}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600;">Property</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${fields['Property Address']}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7c2e; font-size: 14px; font-weight: 600;">Cancellation Fee</td>
                    <td style="padding: 10px 0; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">£0.00 (Free cancellation)</td>
                  </tr>
                </table>
              </div>

              ${fields['Payment Status'] === 'Paid' ? `
              <!-- Refund Alert -->
              <div style="padding: 16px; background-color: #f3f7e8; border: 2px solid #3F4D1B; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0 0 4px; color: #3F4D1B; font-size: 15px; font-weight: 700;">✅ Full Refund Issued</p>
                <p style="margin: 0; color: #3F4D1B; font-size: 14px; line-height: 1.6;">A full refund of <strong>£${totalPrice.toFixed(2)}</strong> will be processed to your original payment method within 5–7 business days.</p>
              </div>
              ` : ''}

              ${reason ? `
              <!-- Cancellation Reason -->
              <div style="padding: 16px; background-color: #fff8ee; border: 2px solid #B46100; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0 0 4px; color: #8a4a00; font-size: 15px; font-weight: 700;">Cancellation Reason</p>
                <p style="margin: 0; color: #8a4a00; font-size: 14px; line-height: 1.6;">${reason}</p>
              </div>
              ` : ''}

              <p style="margin: 0 0 25px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">If you'd like to reschedule, you can book a new shoot online at any time.</p>

              <!-- CTA Button -->
              <table role="presentation" style="margin: 0 0 30px;">
                <tr>
                  <td>
                    <a href="https://markebmedia.com/booking.html" style="display: inline-block; background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); color: #FDF3E2; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px;">Book a New Shoot</a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 6px; color: #6b7c2e; font-size: 14px; line-height: 1.6;">If you have any questions, contact us at <a href="mailto:commercial@markebmedia.com" style="color: #B46100; text-decoration: none;">commercial@markebmedia.com</a></p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #3F4D1B;">
              <p style="margin: 0 0 4px; color: #FDF3E2; font-size: 14px; font-weight: 600;">Best regards,</p>
              <p style="margin: 0 0 0; color: rgba(253,243,226,0.75); font-size: 14px;">The Markeb Media Team</p>
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
        console.log(`Cancellation email sent to ${clientEmail}`);
      } catch (emailError) {
        console.error('Failed to send cancellation email:', emailError);
        // Don't fail the cancellation if email fails
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Booking cancelled successfully',
        cancellationCharge: cancellationCharge,
        cancellationChargePercentage: cancellationChargePercentage,
        refundAmount: refundAmount,
        refundNote: refundNote
      })
    };

  } catch (error) {
    console.error('Error cancelling booking:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to cancel booking',
        details: error.message 
      })
    };
  }
};