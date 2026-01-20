// netlify/functions/cancel-booking.js
const Airtable = require('airtable');
const { Resend } = require('resend');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { bookingId, clientEmail, reason } = JSON.parse(event.body);

    if (!bookingId || !clientEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Booking ID and email are required' })
      };
    }

    // Fetch the booking
    const booking = await base('Bookings').find(bookingId);
    const fields = booking.fields;

    // Verify email matches
    if (fields['Client Email'] !== clientEmail) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Email does not match booking' })
      };
    }

    // Check if already cancelled
    if (fields['Booking Status'] === 'Cancelled') {
      return {
        statusCode: 400,
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
        body: JSON.stringify({ 
          error: 'Cancellations within 24 hours require a fee. Please use the paid cancellation option.',
          hoursUntil: Math.round(hoursUntil)
        })
      };
    }

    // Calculate refund details
    const totalPrice = fields['Total Price'];
    const cancellationCharge = 0; // Free cancellation
    const cancellationChargePercentage = 0;
    const refundAmount = totalPrice;

    // Update booking status in Airtable
    await base('Bookings').update(bookingId, {
      'Booking Status': 'Cancelled',
      'Cancellation Date': new Date().toISOString().split('T')[0],
      'Cancellation Reason': reason || 'Customer requested',
      'Cancellation Charge %': cancellationChargePercentage,
      'Cancellation Charge': cancellationCharge,
      'Refund Amount': refundAmount
    });

    // Determine refund note
    let refundNote = '';
    if (fields['Status'] === 'Paid') {
      refundNote = 'A full refund will be processed to your original payment method within 5-7 business days.';
    } else {
      refundNote = 'Your reservation has been released.';
    }

    // Send cancellation confirmation email
    try {
      await resend.emails.send({
        from: 'Markeb Media <commercial@markebmedia.com>',
        to: clientEmail,
        subject: `Booking Cancelled - ${fields['Booking Reference']}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ef4444;">Booking Cancelled</h2>
            
            <p>Hi ${fields['Client Name']},</p>
            
            <p>Your booking has been successfully cancelled.</p>
            
            <div style="background: #f8fafc; border-left: 4px solid #ef4444; padding: 16px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Cancelled Booking Details</h3>
              <p><strong>Reference:</strong> ${fields['Booking Reference']}</p>
              <p><strong>Service:</strong> ${fields['Service Name']}</p>
              <p><strong>Date & Time:</strong> ${new Date(fields['Date']).toLocaleDateString('en-GB')} at ${fields['Time']}</p>
              <p><strong>Property:</strong> ${fields['Property Address']}</p>
              <p><strong>Cancellation Fee:</strong> £0.00 (Free cancellation)</p>
            </div>
            
            ${fields['Status'] === 'Paid' ? `
              <div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 16px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #065f46;">Refund Information</h3>
                <p style="color: #065f46;">A full refund of <strong>£${totalPrice.toFixed(2)}</strong> will be processed to your original payment method within 5-7 business days.</p>
              </div>
            ` : ''}
            
            ${reason ? `
              <p><strong>Cancellation Reason:</strong> ${reason}</p>
            ` : ''}
            
            <p>If you'd like to reschedule instead, please visit our booking page to select a new date and time.</p>
            
            <p style="margin-top: 30px;">
              <a href="https://markebmedia.com/booking" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Book a New Shoot</a>
            </p>
            
            <p style="color: #64748b; margin-top: 30px;">
              If you have any questions, please contact us at <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
            </p>
            
            <p style="color: #64748b;">
              Best regards,<br>
              The Markeb Media Team
            </p>
          </div>
        `
      });
    } catch (emailError) {
      console.error('Failed to send cancellation email:', emailError);
      // Don't fail the cancellation if email fails
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
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
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Failed to cancel booking',
        details: error.message 
      })
    };
  }
};