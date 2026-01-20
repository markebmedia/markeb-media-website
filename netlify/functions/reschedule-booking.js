// netlify/functions/reschedule-booking.js
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
    const { bookingRef, newDate, newTime, clientEmail } = JSON.parse(event.body);

    if (!bookingRef || !newDate || !newTime || !clientEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    console.log(`Rescheduling booking ${bookingRef} to ${newDate} at ${newTime}`);

    // Find the booking by reference and email
    const records = await base('Bookings')
      .select({
        filterByFormula: `AND({Booking Reference} = '${bookingRef}', {Client Email} = '${clientEmail}')`,
        maxRecords: 1
      })
      .firstPage();

    if (records.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Booking not found' })
      };
    }

    const booking = records[0];
    const fields = booking.fields;

    // Check if booking is already cancelled
    if (fields['Booking Status'] === 'Cancelled') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Cannot reschedule a cancelled booking' })
      };
    }

    // Check 24-hour notice requirement
    const originalDateTime = new Date(`${fields['Date']}T${fields['Time']}:00`);
    const now = new Date();
    const hoursUntil = (originalDateTime - now) / (1000 * 60 * 60);

    if (hoursUntil < 24) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Rescheduling requires 24 hours notice',
          hoursUntil: Math.round(hoursUntil)
        })
      };
    }

    // Store original date/time for email
    const originalDate = fields['Date'];
    const originalTime = fields['Time'];

    // Update booking in Airtable
    await base('Bookings').update(booking.id, {
      'Date': newDate,
      'Time': newTime,
      'Last Modified': new Date().toISOString(),
      'Rescheduled': true,
      'Original Date': originalDate,
      'Original Time': originalTime,
      'Reschedule Date': new Date().toISOString().split('T')[0],
      'Cancellation Allowed Until': new Date(new Date(newDate).getTime() - 24 * 60 * 60 * 1000).toISOString()
    });

    console.log(`✅ Booking ${bookingRef} rescheduled successfully`);

    // Send reschedule confirmation email
    try {
      await resend.emails.send({
        from: 'Markeb Media <commercial@markebmedia.com>',
        to: clientEmail,
        subject: `Booking Rescheduled - ${bookingRef}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #3b82f6;">Booking Rescheduled</h2>
            
            <p>Hi ${fields['Client Name']},</p>
            
            <p>Your booking has been successfully rescheduled.</p>
            
            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #92400e;">Previous Booking</h3>
              <p style="color: #92400e;"><strong>Date & Time:</strong> ${new Date(originalDate).toLocaleDateString('en-GB')} at ${originalTime}</p>
            </div>
            
            <div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 16px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #065f46;">New Booking Details</h3>
              <p><strong>Reference:</strong> ${bookingRef}</p>
              <p><strong>Service:</strong> ${fields['Service Name']}</p>
              <p><strong>Date & Time:</strong> ${new Date(newDate).toLocaleDateString('en-GB')} at ${newTime}</p>
              <p><strong>Property:</strong> ${fields['Property Address']}</p>
              <p><strong>Media Specialist:</strong> ${fields['Media Specialist']}</p>
              <p><strong>Total Amount:</strong> £${fields['Total Price'].toFixed(2)}</p>
            </div>
            
            <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <h4 style="margin-top: 0; font-size: 14px; color: #1e40af;">📅 Important Reminders</h4>
              <p style="font-size: 13px; color: #1e40af; margin: 0;">
                • Free cancellation available until 24 hours before your shoot<br>
                • Please ensure property access is arranged<br>
                • Contact us if you need to make any changes
              </p>
            </div>
            
            <p>Looking forward to capturing your property!</p>
            
            <p style="margin-top: 30px;">
              <a href="https://markebmedia.com/manage-booking?ref=${bookingRef}&email=${encodeURIComponent(clientEmail)}" 
                 style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Manage Your Booking
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
        `
      });

      console.log(`Reschedule confirmation sent to ${clientEmail}`);
    } catch (emailError) {
      console.error('Failed to send reschedule email:', emailError);
      // Don't fail the request if email fails
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: 'Booking rescheduled successfully',
        bookingRef: bookingRef,
        newDate: newDate,
        newTime: newTime
      })
    };

  } catch (error) {
    console.error('Error rescheduling booking:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Failed to reschedule booking',
        details: error.message 
      })
    };
  }
};