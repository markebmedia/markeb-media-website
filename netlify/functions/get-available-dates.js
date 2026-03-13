// netlify/functions/get-available-dates.js
// Returns list of dates that have at least one available slot for a region/month
// Includes Google Maps distance check for days with existing bookings

const Airtable = require('airtable');
const fetch = require('node-fetch');

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
    const { region, year, month, postcode } = JSON.parse(event.body);

    if (!region || year === undefined || month === undefined) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: region, year, month' })
      };
    }

    const capitalizedRegion = region.charAt(0).toUpperCase() + region.slice(1).toLowerCase();

    // Build list of valid weekdays in the month (Mon-Fri only, future dates within 60 days, beyond 24hrs)
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 60);
    maxDate.setHours(23, 59, 59, 999);

    const weekdays = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      date.setHours(0, 0, 0, 0);
      const dayOfWeek = date.getDay();

      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      if (date < today) continue;
      if (date > maxDate) continue;

      const hoursUntil = (date - new Date()) / (1000 * 60 * 60);
      if (hoursUntil < 24) continue;

      weekdays.push(toLocalDateString(date));
    }

    if (weekdays.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ availableDates: [] })
      };
    }

    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    console.log(`[get-available-dates] Region: ${capitalizedRegion}, ${monthStart} to ${monthEnd}, postcode: ${postcode || 'none'}`);

    // Fetch bookings and blocked times for this region/month in parallel
    const [bookingRecords, blockedRecords] = await Promise.all([
      base('Bookings')
        .select({
          filterByFormula: `AND(
            {Region} = '${capitalizedRegion}',
            IS_SAME({Date}, '${monthStart}', 'month'),
            OR(
              {Booking Status} = 'Booked',
              {Booking Status} = 'Reserved',
              {Booking Status} = 'Confirmed'
            )
          )`,
          fields: ['Date', 'Time', 'Duration (mins)', 'Region', 'Booking Status', 'Postcode', 'Property Address']
        })
        .all(),

      base('Blocked Times')
        .select({
          filterByFormula: `AND(
            {Region} = '${capitalizedRegion}',
            IS_SAME({Date}, '${monthStart}', 'month')
          )`,
          fields: ['Date', 'Start Time', 'End Time', 'Region']
        })
        .all()
    ]);

    console.log(`[get-available-dates] Found ${bookingRecords.length} bookings, ${blockedRecords.length} blocked times`);

    // Group bookings by date
    const bookingsByDate = {};
    bookingRecords.forEach(record => {
      const date = record.fields['Date']?.split('T')[0];
      if (!date) return;
      if (!bookingsByDate[date]) bookingsByDate[date] = [];
      const bookingPostcode = record.fields['Postcode'] || extractPostcode(record.fields['Property Address'] || '');
      bookingsByDate[date].push({
        startTime: record.fields['Time'],
        duration: record.fields['Duration (mins)'] || 90,
        postcode: bookingPostcode
      });
    });

    // Group blocked times by date
    const blockedByDate = {};
    blockedRecords.forEach(record => {
      const date = record.fields['Date']?.split('T')[0];
      if (!date) return;
      if (!blockedByDate[date]) blockedByDate[date] = [];
      blockedByDate[date].push({
        startTime: record.fields['Start Time'],
        endTime: record.fields['End Time']
      });
    });

    // For each valid weekday, check if at least one slot is available
    const availableDates = [];
    const maxDriveMinutes = 45;

    for (const dateString of weekdays) {
      const bookings = bookingsByDate[dateString] || [];
      const blockedTimes = blockedByDate[dateString] || [];

      // ✅ Distance check — if client postcode provided and day has bookings
      if (postcode && bookings.length > 0) {
        let tooFar = false;

        for (const booking of bookings) {
          if (!booking.postcode) continue;

          try {
            const driveTime = await getDriveTime(postcode, booking.postcode);
            console.log(`[get-available-dates] ${dateString}: drive time ${postcode} → ${booking.postcode} = ${driveTime} mins`);

            if (driveTime > maxDriveMinutes) {
              console.log(`[get-available-dates] ${dateString}: too far (${driveTime} mins) — greying out`);
              tooFar = true;
              break;
            }
          } catch (error) {
            // If drive time check fails, don't block the day — let check-availability handle it
            console.error(`[get-available-dates] Drive time check failed for ${dateString}:`, error.message);
          }
        }

        if (tooFar) continue; // Skip this day — grey it out
      }

      // Time slot check
      let slots = generateAllTimeSlots();
      slots = applyBlockedTimes(slots, blockedTimes);
      slots = applyBookingBuffers(slots, bookings);

      const hasAvailable = slots.some(s => s.available);
      if (hasAvailable) {
        availableDates.push(dateString);
      }
    }

    console.log(`[get-available-dates] Returning ${availableDates.length} available dates`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        availableDates,
        region: capitalizedRegion,
        month: `${year}-${String(month + 1).padStart(2, '0')}`
      })
    };

  } catch (error) {
    console.error('[get-available-dates] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Failed to get available dates' })
    };
  }
};

// Get drive time between two postcodes using Google Maps Distance Matrix API
async function getDriveTime(fromPostcode, toPostcode) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    throw new Error('Google Maps API key not configured');
  }

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(fromPostcode)}&destinations=${encodeURIComponent(toPostcode)}&mode=driving&departure_time=now&key=${apiKey}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Google Maps API request failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.status !== 'OK') {
    throw new Error(`Google Maps API error: ${data.status}`);
  }

  const element = data.rows[0]?.elements[0];

  if (!element || element.status !== 'OK') {
    throw new Error(`No route found: ${element?.status || 'Unknown error'}`);
  }

  const duration = element.duration_in_traffic || element.duration;
  return Math.ceil(duration.value / 60);
}

// Extract postcode from address string
function extractPostcode(address) {
  if (!address) return '';
  const postcodeRegex = /([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})/i;
  const match = address.match(postcodeRegex);
  return match ? match[0].trim().toUpperCase() : '';
}

// Generate all possible time slots (9:00 AM - 3:00 PM, 30-min intervals)
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

// Apply blocked times to slots
function applyBlockedTimes(slots, blockedTimes) {
  blockedTimes.forEach(blocked => {
    const blockStart = timeToMinutes(blocked.startTime);
    const blockEnd = timeToMinutes(blocked.endTime);
    slots.forEach(slot => {
      const slotMinutes = timeToMinutes(slot.time);
      if (slotMinutes >= blockStart && slotMinutes < blockEnd) {
        slot.available = false;
      }
    });
  });
  return slots;
}

// Apply booking buffers (45 min before + booking duration + 45 min after)
function applyBookingBuffers(slots, bookings) {
  const fixedBuffer = 45;
  const endOfDay = timeToMinutes('15:30');

  bookings.forEach(booking => {
    const bookingStart = timeToMinutes(booking.startTime);
    const bookingEnd = bookingStart + booking.duration;
    const bufferStart = bookingStart - fixedBuffer;
    const bufferEnd = bookingEnd + fixedBuffer;

    slots.forEach(slot => {
      const slotMinutes = timeToMinutes(slot.time);
      if (slotMinutes >= bufferStart && slotMinutes < bufferEnd) {
        slot.available = false;
      }
    });
  });

  // Block slots where a 90min booking would run past end of day
  slots.forEach(slot => {
    if (!slot.available) return;
    const slotEnd = timeToMinutes(slot.time) + 90;
    if (slotEnd > endOfDay) {
      slot.available = false;
    }
  });

  return slots;
}

function timeToMinutes(timeString) {
  if (!timeString) return 0;
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

function toLocalDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}