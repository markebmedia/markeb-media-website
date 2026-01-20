// netlify/functions/stripe-cancellation-webhook.js
const Airtable = require('airtable');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_CANCELLATION_WEBHOOK_SECRET;

  let stripeEvent;

  try {
    // Verify webhook signature
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
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

      // Fetch full booking details for email
      const booking = await base('Bookings').find(bookingId);
      const fields = booking.fields;

      // Send cancellation confirmation email
      try {
        await resend.emails.send({
          from: 'Markeb Media <commercial@markebmedia.com>',
          to: fields['Client Email'],
          subject: `Booking Cancelled - ${bookingRef}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #ef4444;">Booking Cancelled</h2>
              
              <p>Hi ${fields['Client Name']},</p>
              
              <p>Your booking has been cancelled and the cancellation fee has been processed.</p>
              
              <div style="background: #f8fafc; border-left: 4px solid #ef4444; padding: 16px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Cancelled Booking Details</h3>
                <p><strong>Reference:</strong> ${bookingRef}</p>
                <p><strong>Service:</strong> ${fields['Service Name']}</p>
                <p><strong>Date & Time:</strong> ${new Date(fields['Date']).toLocaleDateString('en-GB')} at ${fields['Time']}</p>
                <p><strong>Property:</strong> ${fields['Property Address']}</p>
              </div>
              
              <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #92400e;">Cancellation Fee</h3>
                <p style="color: #92400e;"><strong>${cancellationType}:</strong> £${cancellationFeeAmount.toFixed(2)}</p>
                <p style="color: #92400e; font-size: 14px;">This fee has been charged to your payment method.</p>
              </div>
              
              ${refundAmount > 0 ? `
                <div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 16px; margin: 20px 0;">
                  <h3 style="margin-top: 0; color: #065f46;">Refund Information</h3>
                  <p style="color: #065f46;">A refund of <strong>£${refundAmount.toFixed(2)}</strong> will be processed to your original payment method within 5-7 business days.</p>
                </div>
              ` : ''}
              
              ${cancellationReason && cancellationReason !== 'No reason provided' ? `
                <p><strong>Cancellation Reason:</strong> ${cancellationReason}</p>
              ` : ''}
              
              <p>If you'd like to book again in the future, we'd be happy to help you schedule a new shoot.</p>
              
              <p style="margin-top: 30px;">
                <a href="https://markebmedia.com/booking" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Book a New Shoot</a>
              </p>
              
              <p style="color: #64748b; margin-top: 30px;">
                If you have any questions about this cancellation, please contact us at <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
              </p>
              
              <p style="color: #64748b;">
                Best regards,<br>
                The Markeb Media Team
              </p>
            </div>
          `
        });

        console.log(`Cancellation confirmation email sent to ${fields['Client Email']}`);
      } catch (emailError) {
        console.error('Failed to send cancellation email:', emailError);
        // Don't fail the webhook if email fails
      }

      console.log(`Successfully processed cancellation for booking ${bookingRef}`);

      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, status: 'Cancellation processed' })
      };

    } catch (error) {
      console.error('Error processing cancellation webhook:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to process cancellation', details: error.message })
      };
    }
  }

  // Return 200 for other event types
  return {
    statusCode: 200,
    body: JSON.stringify({ received: true })
  };
};