// netlify/functions/reschedule-booking.js
// Reschedules a booking to a new date/time after checking availability
// Uses the booking's existing postcode from Airtable (no need to re-enter address)

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
    const { bookingRef, newDate, newTime, clientEmail } = JSON.parse(event.body);

    if (!bookingRef || !newDate || !newTime || !clientEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Missing required fields' })
      };
    }

    console.log(`Rescheduling booking ${bookingRef} to ${newDate} at ${newTime}`);

    // Find the booking
    const records = await base('Bookings')
      .select({
        filterByFormula: `AND({Booking Reference} = '${bookingRef}', {Client Email} = '${clientEmail}')`,
        maxRecords: 1
      })
      .firstPage();

    if (records.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Booking not found' })
      };
    }

    const booking = records[0];
    const fields = booking.fields;

    // Check if already cancelled
    if (fields['Booking Status'] === 'Cancelled') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Cannot reschedule a cancelled booking' })
      };
    }

    // Check 24-hour policy
    const originalDateTime = new Date(`${fields['Date']}T${fields['Time']}`);
    const now = new Date();
    const hoursUntil = (originalDateTime - now) / (1000 * 60 * 60);

    if (hoursUntil < 24) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Rescheduling requires 24 hours notice',
          hoursUntil: Math.round(hoursUntil)
        })
      };
    }

    // ✅ Use the booking's existing postcode and region (already in Airtable)
    const postcode = fields['Postcode'];
    const region = fields['Region']; // Already capitalized (North/South)

    if (!postcode || !region) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Booking missing postcode or region data' 
        })
      };
    }

    console.log(`Using existing booking data: postcode=${postcode}, region=${region}`);

    // ✅ Check availability using the SAME logic as check-availability.js
    const availabilityCheck = await checkAvailabilityForReschedule(
      postcode, 
      region, 
      newDate, 
      newTime,
      booking.id // Exclude this booking from availability check
    );

    if (!availabilityCheck.available) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Selected time is not available',
          reason: availabilityCheck.reason,
          availableSlots: availabilityCheck.availableSlots
        })
      };
    }

    // Store original date/time
    const originalDate = fields['Date'];
    const originalTime = fields['Time'];

    // Update booking
    await base('Bookings').update(booking.id, {
      'Date': newDate,
      'Time': newTime,
      'Rescheduled': true,
      'Rescheduled By': 'Customer',
      'Original Date': originalDate,
      'Original Time': originalTime,
      'Reschedule Date': new Date().toISOString().split('T')[0]
    });

    console.log(`✅ Booking ${bookingRef} rescheduled successfully`);

    // Send confirmation email
    if (process.env.RESEND_API_KEY) {
      try {
        await sendRescheduleEmail(fields, newDate, newTime, originalDate, originalTime);
      } catch (emailError) {
        console.error('Failed to send email:', emailError);
      }
    }

    return {
      statusCode: 200,
      headers,
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
      headers,
      body: JSON.stringify({ 
        success: false,
        error: 'Failed to reschedule booking',
        details: error.message 
      })
    };
  }
};

// ✅ Check availability using SAME logic as check-availability.js
async function checkAvailabilityForReschedule(postcode, region, selectedDate, requestedTime, excludeBookingId) {
  try {
    // Check 24-hour notice
    const selectedDateObj = new Date(selectedDate + 'T00:00:00');
    const now = new Date();
    const hoursDifference = (selectedDateObj - now) / (1000 * 60 * 60);

    if (hoursDifference < 24) {
      return {
        available: false,
        reason: 'Bookings require 24 hours notice',
        availableSlots: []
      };
    }

    // Fetch existing bookings for this region/date (excluding current booking)
    const bookings = await fetchBookingsForRegion(region, selectedDate, excludeBookingId);

    // If no other bookings, time is available
    if (bookings.length === 0) {
      return { available: true };
    }

    // Check if requested time conflicts with existing bookings
    const requestedTimeMinutes = timeToMinutes(requestedTime);
    const maxDriveMinutes = 45;
    const fixedBufferMinutes = 45;

    // Step 1: Check drive time to all existing bookings
    for (const booking of bookings) {
      if (!booking.postcode) continue;

      const driveTime = await getDriveTime(postcode, booking.postcode);
      
      if (driveTime > maxDriveMinutes) {
        return {
          available: false,
          reason: `Too far from existing booking (${driveTime} min drive)`,
          availableSlots: []
        };
      }
    }

    // Step 2: Check if requested time conflicts with buffers
    for (const booking of bookings) {
      const bookingStartMinutes = timeToMinutes(booking.startTime);
      const bookingEndMinutes = bookingStartMinutes + booking.duration;
      
      const bufferStartMinutes = bookingStartMinutes - fixedBufferMinutes;
      const bufferEndMinutes = bookingEndMinutes + fixedBufferMinutes;

      // Check if requested time falls in blocked period
      if (requestedTimeMinutes >= bufferStartMinutes && requestedTimeMinutes < bufferEndMinutes) {
        return {
          available: false,
          reason: `Conflicts with booking at ${booking.startTime}`,
          availableSlots: await calculateAvailableSlots(postcode, bookings)
        };
      }
    }

    return { available: true };

  } catch (error) {
    console.error('Error checking availability:', error);
    throw error;
  }
}

// Fetch bookings (excluding current booking being rescheduled)
async function fetchBookingsForRegion(region, selectedDate, excludeBookingId) {
  const filterFormula = excludeBookingId
    ? `AND({Region} = '${region}', IS_SAME({Date}, '${selectedDate}', 'day'), {Booking Status} = 'Booked', RECORD_ID() != '${excludeBookingId}')`
    : `AND({Region} = '${region}', IS_SAME({Date}, '${selectedDate}', 'day'), {Booking Status} = 'Booked')`;

  const records = await base('Bookings')
    .select({
      filterByFormula: filterFormula,
      sort: [{ field: 'Time', direction: 'asc' }]
    })
    .firstPage();

  return records.map(record => ({
    id: record.id,
    postcode: record.fields['Postcode'],
    startTime: record.fields['Time'],
    duration: record.fields['Duration (mins)'] || 90
  }));
}

// Calculate available slots
async function calculateAvailableSlots(userPostcode, existingBookings) {
  const allSlots = generateAllTimeSlots();
  const fixedBufferMinutes = 45;

  for (const booking of existingBookings) {
    if (!booking.postcode) continue;

    const bookingStartMinutes = timeToMinutes(booking.startTime);
    const bookingEndMinutes = bookingStartMinutes + booking.duration;
    
    const bufferStartMinutes = bookingStartMinutes - fixedBufferMinutes;
    const bufferEndMinutes = bookingEndMinutes + fixedBufferMinutes;

    allSlots.forEach(slot => {
      const slotMinutes = timeToMinutes(slot.time);
      
      if (slotMinutes >= bufferStartMinutes && slotMinutes < bufferEndMinutes) {
        slot.available = false;
        slot.reason = `Conflicts with booking at ${booking.startTime}`;
      }
    });
  }

  return allSlots.filter(s => s.available);
}

// Generate all time slots
function generateAllTimeSlots() {
  const slots = [];
  for (let hour = 9; hour <= 15; hour++) {
    for (let minute of [0, 30]) {
      if (hour === 15 && minute === 30) break;
      slots.push({
        time: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
        available: true
      });
    }
  }
  return slots;
}

// Get drive time
async function getDriveTime(fromPostcode, toPostcode) {
  const fetch = require('node-fetch');
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) throw new Error('Google Maps API key not configured');
  
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(fromPostcode)}&destinations=${encodeURIComponent(toPostcode)}&mode=driving&key=${apiKey}`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK') throw new Error(`Google Maps API error: ${data.status}`);
  
  const element = data.rows[0]?.elements[0];
  if (!element || element.status !== 'OK') throw new Error('No route found');
  
  return Math.ceil(element.duration.value / 60);
}

// Time conversion helpers
function timeToMinutes(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

// Send reschedule email
async function sendRescheduleEmail(fields, newDate, newTime, originalDate, originalTime) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  const formattedNewDate = new Date(newDate).toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  await resend.emails.send({
    from: 'Markeb Media <commercial@markebmedia.com>',
    to: fields['Client Email'],
    bcc: 'commercial@markebmedia.com',
    subject: `Booking Rescheduled - ${fields['Booking Reference']}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #3b82f6;">Booking Rescheduled</h2>
        <p>Hi ${fields['Client Name']},</p>
        <p>Your booking has been successfully rescheduled.</p>
        
        <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 16px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #065f46;">New Date & Time</h3>
          <p style="color: #065f46; margin: 0;"><strong>${formattedNewDate} at ${newTime}</strong></p>
        </div>
        
        <div style="background: #f8fafc; padding: 16px; margin: 20px 0;">
          <p><strong>Reference:</strong> ${fields['Booking Reference']}</p>
          <p><strong>Service:</strong> ${fields['Service']}</p>
          <p><strong>Property:</strong> ${fields['Property Address']}</p>
        </div>
        
        <p>Best regards,<br>The Markeb Media Team</p>
      </div>
    `
  });
}