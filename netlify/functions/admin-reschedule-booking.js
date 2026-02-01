// netlify/functions/admin-reschedule-booking.js
// UPDATED: Now syncs date changes to Active Bookings table
const Airtable = require('airtable');

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
    const { bookingId, newDate, newTime, sendEmail = true } = JSON.parse(event.body);

    if (!bookingId || !newDate || !newTime) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Missing required fields' })
      };
    }

    console.log(`[ADMIN] Rescheduling booking ${bookingId} to ${newDate} at ${newTime}`);

    // Fetch the booking
    const booking = await base('Bookings').find(bookingId);
    const fields = booking.fields;

    // Check if booking is already cancelled
    if (fields['Booking Status'] === 'Cancelled') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Cannot reschedule a cancelled booking' })
      };
    }

    // Store original date/time for email
    const originalDate = fields['Date'];
    const originalTime = fields['Time'];

    // Calculate new cancellation deadline (24 hours before new booking)
    const newBookingDateTime = new Date(`${newDate}T${newTime}`);
    const cancellationDeadline = new Date(newBookingDateTime.getTime() - 24 * 60 * 60 * 1000);

    // Update booking in Airtable
    await base('Bookings').update(bookingId, {
      'Date': newDate,
      'Time': newTime,
      'Rescheduled': true,
      'Rescheduled By': 'Admin',
      'Original Date': originalDate,
      'Original Time': originalTime,
      'Reschedule Date': new Date().toISOString().split('T')[0],
      'Cancellation Allowed Until': cancellationDeadline.toISOString()
    });

    console.log(`✅ Booking ${fields['Booking Reference']} rescheduled successfully by admin`);

    // ✅ NEW: Update Active Bookings record to match
    try {
      const bookingRef = fields['Booking Reference'];
      
      const activeBookings = await base('tblRgcv7M9dUU3YuL')
        .select({
          filterByFormula: `{Booking ID} = '${bookingRef}'`,
          maxRecords: 1
        })
        .firstPage();

      if (activeBookings && activeBookings.length > 0) {
        const activeBookingId = activeBookings[0].id;
        
        await base('tblRgcv7M9dUU3YuL').update(activeBookingId, {
          'Shoot Date': newDate
        });
        
        console.log(`✓ Active Booking synced with rescheduled date`);
      } else {
        console.log(`⚠️ No Active Booking found for ${bookingRef}`);
      }
    } catch (activeBookingError) {
      console.error('Error syncing Active Booking:', activeBookingError);
    }

    // Send reschedule confirmation email (if enabled)
    let emailSent = false;
    if (sendEmail) {
      try {
        await sendRescheduleEmail({
          clientName: fields['Client Name'],
          clientEmail: fields['Client Email'],
          bookingRef: fields['Booking Reference'],
          originalDate: originalDate,
          originalTime: originalTime,
          newDate: newDate,
          newTime: newTime,
          service: fields['Service'],
          propertyAddress: fields['Property Address'],
          mediaSpecialist: fields['Media Specialist'],
          totalPrice: fields['Total Price']
        });
        console.log(`Reschedule email sent to ${fields['Client Email']}`);
        emailSent = true;
      } catch (emailError) {
        console.error('Failed to send reschedule email:', emailError);
        // Don't fail the request if email fails
      }
    } else {
      console.log('Email notification skipped (admin choice)');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Booking rescheduled successfully',
        bookingRef: fields['Booking Reference'],
        newDate: newDate,
        newTime: newTime,
        emailSent: emailSent
      })
    };

  } catch (error) {
    console.error('Error rescheduling booking:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false,
        error: 'Failed to reschedule booking',
        details: error.message 
      })
    };
  }
};

// Send reschedule confirmation email
async function sendRescheduleEmail(data) {
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
    originalDate,
    originalTime,
    newDate,
    newTime,
    service,
    propertyAddress,
    mediaSpecialist,
    totalPrice
  } = data;

  const formattedOriginalDate = new Date(originalDate).toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const formattedNewDate = new Date(newDate).toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #3b82f6;">Booking Rescheduled</h2>
      
      <p>Hi ${clientName},</p>
      
      <p>Your booking has been successfully rescheduled.</p>
      
      <div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #991b1b;">Previous Date & Time</h3>
        <p style="color: #991b1b; margin: 0;"><strong>${formattedOriginalDate} at ${originalTime}</strong></p>
      </div>
      
      <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #065f46;">New Date & Time</h3>
        <p style="color: #065f46; margin: 0;"><strong>${formattedNewDate} at ${newTime}</strong></p>
      </div>
      
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Booking Details</h3>
        <p><strong>Reference:</strong> ${bookingRef}</p>
        <p><strong>Service:</strong> ${service}</p>
        <p><strong>Property:</strong> ${propertyAddress}</p>
        <p><strong>Media Specialist:</strong> ${mediaSpecialist}</p>
        <p><strong>Total Price:</strong> £${totalPrice?.toFixed(2) || '0.00'}</p>
      </div>
      
      <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 20px 0;">
        <p style="margin: 0; color: #1e40af;">
          <strong>📅 Add to Calendar:</strong> We recommend adding this new date to your calendar to ensure you don't miss your appointment.
        </p>
      </div>
      
      <p style="margin-top: 30px;">
        <a href="https://markebmedia.com/website/manage-booking.html?ref=${bookingRef}&email=${encodeURIComponent(clientEmail)}" 
           style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Manage Your Booking
        </a>
      </p>
      
      <p style="color: #64748b; margin-top: 30px;">
        If you have any questions about your rescheduled booking, please contact us at 
        <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
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
    subject: `Booking Rescheduled - ${bookingRef}`,
    html: html
  });
}