// netlify/functions/reschedule-booking.js
// UPDATED: Now syncs date changes to Active Bookings table + FIXED booking status filter
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

    // Use the booking's existing postcode and region
    const postcode = fields['Postcode'];
    const region = fields['Region'];

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

    // Check availability
    const availabilityCheck = await checkAvailabilityForReschedule(
      postcode, 
      region, 
      newDate, 
      newTime,
      booking.id
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
      'Rescheduled By': 'Client',
      'Original Date': originalDate,
      'Original Time': originalTime,
      'Reschedule Date': new Date().toISOString().split('T')[0]
    });

    console.log(`✅ Booking ${bookingRef} rescheduled successfully`);

    // ✅ NEW: Update Active Bookings record to match
    try {
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

// Check availability using SAME logic as check-availability.js
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

// ✅ FIXED: Fetch bookings (excluding current booking being rescheduled)
async function fetchBookingsForRegion(region, selectedDate, excludeBookingId) {
  const filterFormula = excludeBookingId
    ? `AND(
        {Region} = '${region}', 
        IS_SAME({Date}, '${selectedDate}', 'day'), 
        OR(
          {Booking Status} = 'Booked',
          {Booking Status} = 'Reserved',
          {Booking Status} = 'Confirmed'
        ),
        RECORD_ID() != '${excludeBookingId}'
      )`
    : `AND(
        {Region} = '${region}', 
        IS_SAME({Date}, '${selectedDate}', 'day'), 
        OR(
          {Booking Status} = 'Booked',
          {Booking Status} = 'Reserved',
          {Booking Status} = 'Confirmed'
        )
      )`;

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
  const formattedOriginalDate = new Date(originalDate).toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // ✅ Determine BCC recipients based on region
  const bccRecipients = ['commercial@markebmedia.com'];
  if (fields['Region']) {
    if (fields['Region'].toLowerCase() === 'north') {
      bccRecipients.push('Jodie.Hamshaw@markebmedia.com');
      console.log('✓ BCC: Adding Jodie (North region)');
    } else if (fields['Region'].toLowerCase() === 'south') {
      bccRecipients.push('Maeve.Darley@markebmedia.com');
      console.log('✓ BCC: Adding Maeve (South region)');
    }
  }

  await resend.emails.send({
    from: 'Markeb Media <commercial@markebmedia.com>',
    to: fields['Client Email'],
    bcc: bccRecipients,
    subject: `Booking Rescheduled - ${fields['Booking Reference']}`,
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
              <div style="font-size: 40px; margin-bottom: 12px;">📅</div>
              <h1 style="margin: 0; color: #FDF3E2; font-size: 28px; font-weight: 600; letter-spacing: -0.02em;">Booking Rescheduled</h1>
              <p style="margin: 10px 0 0; color: rgba(253,243,226,0.8); font-size: 15px;">Your shoot has been moved to a new date</p>
              <div style="width: 40px; height: 3px; background: #B46100; margin: 16px auto 0; border-radius: 2px;"></div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Hi ${fields['Client Name']},</p>
              <p style="margin: 0 0 25px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Your booking has been successfully rescheduled.</p>

              <!-- Date Change -->
              <div style="margin: 0 0 24px;">

                <!-- Old date -->
                <div style="padding: 16px 20px; background-color: #f7ead5; border: 2px solid #e8d9be; border-radius: 10px; margin-bottom: 8px;">
                  <div style="font-size: 11px; font-weight: 700; color: #9a7a4a; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px;">Previous Date</div>
                  <div style="font-size: 15px; font-weight: 600; color: #9a7a4a; text-decoration: line-through;">${formattedOriginalDate} at ${originalTime}</div>
                </div>

                <!-- Arrow -->
                <div style="text-align: center; font-size: 20px; color: #B46100; margin: 4px 0;">↓</div>

                <!-- New date -->
                <div style="padding: 16px 20px; background-color: #fff8ee; border: 2px solid #B46100; border-radius: 10px;">
                  <div style="font-size: 11px; font-weight: 700; color: #8a4a00; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px;">New Date</div>
                  <div style="font-size: 18px; font-weight: 700; color: #B46100;">${formattedNewDate} at ${newTime}</div>
                </div>
              </div>

              <!-- Booking Details -->
              <div style="background-color: #f7ead5; border: 2px solid #e8d9be; border-radius: 12px; padding: 24px; margin: 0 0 24px;">
                <h3 style="margin: 0 0 16px; color: #3F4D1B; font-size: 16px; font-weight: 700;">Booking Details</h3>
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
                    <td style="padding: 10px 0; color: #6b7c2e; font-size: 14px; font-weight: 600;">Property</td>
                    <td style="padding: 10px 0; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${fields['Property Address']}</td>
                  </tr>
                </table>
              </div>

              <p style="margin: 0 0 6px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">See you on ${formattedNewDate}!</p>
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
}