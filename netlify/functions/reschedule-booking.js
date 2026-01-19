// netlify/functions/reschedule-booking.js
const Airtable = require('airtable');
const { sendRescheduleConfirmation } = require('./email-service');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { bookingId, newDate, newTime, clientEmail } = JSON.parse(event.body);

    if (!bookingId || !newDate || !newTime || !clientEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    console.log('Rescheduling booking:', bookingId, 'to', newDate, newTime);

    // Verify the booking belongs to this email
    const booking = await base('Bookings').find(bookingId);
    
    if (booking.fields['Client Email'] !== clientEmail) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    // Check if rescheduling is allowed (24 hours before original date)
    const originalDate = new Date(booking.fields['Date']);
    const now = new Date();
    const hoursUntilBooking = (originalDate - now) / (1000 * 60 * 60);

    if (hoursUntilBooking < 24) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Cannot reschedule within 24 hours of booking',
          hoursRemaining: Math.round(hoursUntilBooking)
        })
      };
    }

    // Check if the booking is already cancelled
    if (booking.fields['Status'] === 'Cancelled') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Cannot reschedule a cancelled booking' })
      };
    }

    // Save old date/time before updating
    const oldDate = booking.fields['Date'];
    const oldTime = booking.fields['Time'];

    console.log('Old date/time:', oldDate, oldTime);
    console.log('New date/time:', newDate, newTime);

    // Update the booking with new date/time
    const updatedRecord = await base('Bookings').update([
      {
        id: bookingId,
        fields: {
          'Date': newDate,
          'Time': newTime,
          'Status': booking.fields['Payment Status'] === 'Paid' ? 'Confirmed' : 'Reserved - Awaiting Payment',
          'Rescheduled': true,
          'Original Date': booking.fields['Date'],
          'Original Time': booking.fields['Time'],
          'Rescheduled Date': new Date().toISOString(),
          'Cancellation Allowed Until': new Date(new Date(newDate).getTime() - 24 * 60 * 60 * 1000).toISOString()
        }
      }
    ]);

    console.log('✅ Booking rescheduled successfully');

    // Send reschedule confirmation email
    try {
      await sendRescheduleConfirmation({
        clientName: booking.fields['Client Name'],
        clientEmail: clientEmail,
        bookingRef: booking.fields['Booking Reference'],
        date: newDate,
        time: newTime,
        service: booking.fields['Service Name'],
        propertyAddress: booking.fields['Property Address'],
        mediaSpecialist: booking.fields['Media Specialist'] // ✅ FIX: Changed from Media Specialist to mediaSpecialist
      }, oldDate, oldTime);
      
      console.log('Reschedule confirmation sent to:', clientEmail);
    } catch (emailError) {
      console.error('Failed to send reschedule confirmation:', emailError);
      // Don't fail the request if email fails
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Booking rescheduled successfully',
        newDate: newDate,
        newTime: newTime
      })
    };

  } catch (error) {
    console.error('❌ Error rescheduling booking:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to reschedule booking',
        details: error.message 
      })
    };
  }
};