// netlify/functions/admin-reschedule-booking.js
const Airtable = require('airtable');
const { sendRescheduleConfirmation } = require('./email-service');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { bookingId, newDate, newTime, sendEmail = true } = JSON.parse(event.body);

    if (!bookingId || !newDate || !newTime) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
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
        body: JSON.stringify({ error: 'Cannot reschedule a cancelled booking' })
      };
    }

    // Store original date/time for email
    const originalDate = fields['Date'];
    const originalTime = fields['Time'];

    // Update booking in Airtable
    await base('Bookings').update(bookingId, {
      'Date': newDate,
      'Time': newTime,
      'Last Modified': new Date().toISOString(),
      'Rescheduled': true,
      'Rescheduled By': 'Admin',
      'Original Date': originalDate,
      'Original Time': originalTime,
      'Reschedule Date': new Date().toISOString().split('T')[0],
      'Cancellation Allowed Until': new Date(new Date(newDate).getTime() - 24 * 60 * 60 * 1000).toISOString()
    });

    console.log(`✅ Booking ${fields['Booking Reference']} rescheduled successfully by admin`);

    // Send reschedule confirmation email (if enabled)
    if (sendEmail) {
      try {
        await sendRescheduleConfirmation(
          {
            clientName: fields['Client Name'],
            clientEmail: fields['Client Email'],
            bookingRef: fields['Booking Reference'],
            date: newDate,
            time: newTime,
            service: fields['Service Name'],
            propertyAddress: fields['Property Address'],
            mediaSpecialist: fields['Media Specialist']
          },
          originalDate,
          originalTime
        );
        console.log(`Reschedule email sent to ${fields['Client Email']}`);
      } catch (emailError) {
        console.error('Failed to send reschedule email:', emailError);
        // Don't fail the request if email fails
      }
    } else {
      console.log('Email notification skipped (admin choice)');
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
        bookingRef: fields['Booking Reference'],
        newDate: newDate,
        newTime: newTime,
        emailSent: sendEmail
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