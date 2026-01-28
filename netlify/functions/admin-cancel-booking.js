// netlify/functions/admin-cancel-booking.js
const Airtable = require('airtable');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const { bookingId, reason = 'Admin cancelled', sendEmail = true } = JSON.parse(event.body);

    if (!bookingId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Missing booking ID' })
      };
    }

    console.log(`[ADMIN] Cancelling booking ${bookingId}. Reason: ${reason}`);

    // Fetch the booking
    const booking = await base('Bookings').find(bookingId);
    const fields = booking.fields;

    // Check if already cancelled
    if (fields['Booking Status'] === 'Cancelled') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Booking is already cancelled' })
      };
    }

    const bookingDate = new Date(fields['Date']);
    const now = new Date();
    const hoursUntilBooking = (bookingDate - now) / (1000 * 60 * 60);

    let cancellationCharge = 0;
    let refundAmount = 0;
    let refundProcessed = false;

    // Calculate cancellation fees for paid bookings
    const isPaidBooking = fields['Payment Status'] === 'Paid';
    
    if (isPaidBooking) {
      const totalPrice = fields['Total Price'] || 0;

      if (hoursUntilBooking < 24) {
        // Less than 24 hours: 100% charge
        cancellationCharge = totalPrice;
        refundAmount = 0;
      } else if (hoursUntilBooking < 48) {
        // 24-48 hours: 50% charge
        cancellationCharge = totalPrice * 0.5;
        refundAmount = totalPrice * 0.5;
      } else {
        // More than 48 hours: Full refund
        cancellationCharge = 0;
        refundAmount = totalPrice;
      }

      // Process refund if applicable
      if (refundAmount > 0 && fields['Stripe Payment Intent ID']) {
        try {
          const refund = await stripe.refunds.create({
            payment_intent: fields['Stripe Payment Intent ID'],
            amount: Math.round(refundAmount * 100),
            reason: 'requested_by_customer',
            metadata: {
              bookingRef: fields['Booking Reference'],
              bookingId: bookingId,
              cancelledBy: 'Admin',
              cancellationReason: reason
            }
          });

          refundProcessed = true;
          console.log(`✅ Refund processed: £${refundAmount.toFixed(2)} (${refund.id})`);
        } catch (stripeError) {
          console.error('Stripe refund error:', stripeError);
          // Continue with cancellation even if refund fails
        }
      }
    }

    // ✅ Update booking in Airtable - REMOVE 'Last Modified' (computed field)
    await base('Bookings').update(bookingId, {
      'Booking Status': 'Cancelled',
      'Cancellation Date': new Date().toISOString(),
      'Cancellation Reason': reason,
      'Cancelled By': 'Admin',
      'Cancellation Fee': cancellationCharge,
      'Refund Amount': refundAmount,
      'Refund Processed': refundProcessed
    });

    console.log(`✅ Booking ${fields['Booking Reference']} cancelled by admin`);

    // Send cancellation email (if enabled)
    let emailSent = false;
    if (sendEmail) {
      try {
        await sendCancellationEmail({
          clientName: fields['Client Name'],
          clientEmail: fields['Client Email'],
          bookingRef: fields['Booking Reference'],
          date: fields['Date'],
          time: fields['Time'],
          service: fields['Service'], // ✅ FIXED: Was 'Service Name', now 'Service'
          propertyAddress: fields['Property Address'],
          cancellationReason: reason,
          cancellationCharge: cancellationCharge,
          refundAmount: refundAmount,
          refundProcessed: refundProcessed,
          totalPrice: fields['Total Price']
        });
        console.log(`Cancellation email sent to ${fields['Client Email']}`);
        emailSent = true;
      } catch (emailError) {
        console.error('Failed to send cancellation email:', emailError);
      }
    } else {
      console.log('Email notification skipped (admin choice)');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Booking cancelled successfully',
        bookingRef: fields['Booking Reference'],
        cancellationCharge: cancellationCharge,
        refundAmount: refundAmount,
        refundProcessed: refundProcessed,
        emailSent: emailSent
      })
    };

  } catch (error) {
    console.error('Error cancelling booking:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false,
        error: 'Failed to cancel booking',
        details: error.message 
      })
    };
  }
};

// Send cancellation confirmation email
async function sendCancellationEmail(data) {
  // Check if Resend is configured
  if (!process.env.RESEND_API_KEY) {
    console.log('Resend not configured - skipping email');
    return;
  }

  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  const {
    clientName,
    clientEmail,
    bookingRef,
    date,
    time,
    service,
    propertyAddress,
    cancellationReason,
    cancellationCharge,
    refundAmount,
    refundProcessed,
    totalPrice
  } = data;

  const formattedDate = new Date(date).toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  let financialSection = '';

  if (cancellationCharge > 0 || refundAmount > 0) {
    if (refundAmount > 0 && refundProcessed) {
      financialSection = `
        <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 16px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #065f46;">💰 Refund Information</h3>
          <p style="color: #065f46; margin: 0;">
            A refund of <strong>£${refundAmount.toFixed(2)}</strong> will be processed to your original payment method within 5-7 business days.
          </p>
          ${cancellationCharge > 0 ? `
            <p style="color: #065f46; margin: 8px 0 0 0; font-size: 14px;">
              Cancellation fee: £${cancellationCharge.toFixed(2)}
            </p>
          ` : ''}
        </div>
      `;
    } else if (cancellationCharge === totalPrice) {
      financialSection = `
        <div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 16px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #991b1b;">💳 Cancellation Fee</h3>
          <p style="color: #991b1b; margin: 0;">
            As this booking was cancelled within 24 hours of the scheduled time, the full amount of 
            <strong>£${cancellationCharge.toFixed(2)}</strong> has been charged as per our cancellation policy.
          </p>
        </div>
      `;
    }
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ef4444;">Booking Cancelled</h2>
      
      <p>Hi ${clientName},</p>
      
      <p>Your booking has been cancelled.</p>
      
      ${cancellationReason !== 'Admin cancelled' ? `
        <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #92400e;">Cancellation Reason</h3>
          <p style="color: #92400e; margin: 0;">${cancellationReason}</p>
        </div>
      ` : ''}
      
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Cancelled Booking Details</h3>
        <p><strong>Reference:</strong> ${bookingRef}</p>
        <p><strong>Date & Time:</strong> ${formattedDate} at ${time}</p>
        <p><strong>Service:</strong> ${service}</p>
        <p><strong>Property:</strong> ${propertyAddress}</p>
      </div>
      
      ${financialSection}
      
      <p style="margin-top: 30px;">
        We're sorry to see this booking cancelled. If you'd like to rebook in the future, we'd be happy to help.
      </p>
      
      <p style="margin-top: 20px;">
        <a href="https://markebmedia.com/website/booking.html" 
           style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Book Again
        </a>
      </p>
      
      <p style="color: #64748b; margin-top: 30px;">
        Questions? Contact us at <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
      </p>
      
      <p style="color: #64748b;">
        Best regards,<br>
        The Markeb Media Team
      </p>
    </div>
  `;

  await resend.emails.send({
    from: 'Markeb Media <commercial@markebmedia.com>',
    to: clientEmail,
    bcc: 'commercial@markebmedia.com',
    subject: `Booking Cancelled - ${bookingRef}`,
    html: html
  });
}