const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { postcode, region, selectedDate } = JSON.parse(event.body);

    if (!postcode || !region || !selectedDate) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: postcode, region, selectedDate' })
      };
    }

    console.log(`Checking availability for: postcode=${postcode}, region=${region}, date=${selectedDate}`);

    // Check if the selected date is within 24 hours
    const selectedDateObj = new Date(selectedDate + 'T00:00:00');
    const now = new Date();
    const hoursDifference = (selectedDateObj - now) / (1000 * 60 * 60);

    // Block if date is within 24 hours from now
    if (hoursDifference < 24) {
      console.log(`Date is within 24 hours (${hoursDifference.toFixed(1)} hours) - blocking all slots`);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          availableSlots: generateAllTimeSlots().map(slot => ({
            ...slot,
            available: false,
            reason: 'Bookings require 24 hours notice'
          })),
          message: 'Bookings require 24 hours notice'
        })
      };
    }

    // Fetch existing bookings from Airtable for this region and date
    const bookings = await fetchBookingsForRegion(region, selectedDate);

    console.log(`Found ${bookings.length} existing bookings for this date/region`);

    // If no bookings exist for this date, all slots are available
    if (bookings.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          availableSlots: generateAllTimeSlots(),
          message: 'All slots available - no existing bookings'
        })
      };
    }

    // Calculate available time slots based on existing bookings and drive times
    const availableSlots = await calculateAvailableSlots(postcode, bookings);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        availableSlots: availableSlots,
        existingBookings: bookings.length,
        region: region,
        debug: {
          selectedDate,
          bookingDetails: bookings.map(b => ({
            time: b.startTime,
            postcode: b.postcode,
            duration: b.duration
          }))
        }
      })
    };

  } catch (error) {
    console.error('Error checking availability:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message || 'Failed to check availability',
        availableSlots: generateAllTimeSlots() // Fallback to all slots
      })
    };
  }
};

// ✅ SIMPLIFIED: No conversion needed - Airtable now uses ISO format
function formatDateForAirtable(dateString) {
  // If already in YYYY-MM-DD format, return as-is
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return dateString;
  }
  
  // If it's in D/M/YYYY or DD/MM/YYYY format, convert to YYYY-MM-DD
  if (dateString.includes('/')) {
    const parts = dateString.split('/');
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  
  // Try parsing as date object and return ISO format
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    console.error(`Invalid date: ${dateString}`);
    return dateString;
  }
  
  return date.toISOString().split('T')[0];
}

// Fetch bookings from Airtable for specific region and date
async function fetchBookingsForRegion(region, selectedDate) {
  try {
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    // ✅ Ensure date is in ISO format (YYYY-MM-DD)
    const formattedDate = formatDateForAirtable(selectedDate);
    
    // Capitalise region for Airtable (it stores "North" or "South")
    const capitalisedRegion = region.charAt(0).toUpperCase() + region.slice(1).toLowerCase();
    
    console.log(`Querying Airtable with:`);
    console.log(`  - Date: ${formattedDate} (ISO format, original: ${selectedDate})`);
    console.log(`  - Region: ${capitalisedRegion} (original: ${region})`);
    
    const filterFormula = `AND({Region} = '${capitalisedRegion}', {Date} = '${formattedDate}', {Booking Status} = 'Booked')`;
    console.log(`  - Filter: ${filterFormula}`);

    // Query bookings for this specific region and date
    const records = await base('Bookings')
      .select({
        filterByFormula: filterFormula,
        sort: [{ field: 'Time', direction: 'asc' }]
      })
      .firstPage();

    console.log(`Retrieved ${records.length} records from Airtable`);

    // Extract relevant booking info
    const bookings = records.map(record => {
      const postcode = record.fields['Postcode'] || extractPostcode(record.fields['Property Address']);
      const booking = {
        id: record.id,
        postcode: postcode,
        startTime: record.fields['Time'],
        duration: record.fields['Duration'] || 90,
        date: record.fields['Date'],
        region: record.fields['Region']
      };
      
      console.log(`  ✓ Booking: ${booking.startTime} at ${booking.postcode} (${booking.duration}min)`);
      
      return booking;
    });

    return bookings;

  } catch (error) {
    console.error('Error fetching bookings from Airtable:', error);
    throw error; // Throw instead of returning empty array so we can see the error
  }
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
      if (hour === 15 && minute === 30) break; // Stop at 3:00 PM
      
      const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      slots.push({
        time: timeString,
        available: true
      });
    }
  }
  
  return slots;
}

// Calculate available time slots based on drive times and existing bookings
async function calculateAvailableSlots(userPostcode, existingBookings) {
  const allSlots = generateAllTimeSlots();
  const maxDriveMinutes = 45;
  
  console.log(`\nCalculating availability for ${existingBookings.length} existing bookings`);
  
  // STEP 1: Check if user's location is within 45 min drive of ALL existing bookings
  for (const booking of existingBookings) {
    if (!booking.postcode) {
      console.log(`⚠ Skipping booking at ${booking.startTime} - no postcode available`);
      continue;
    }
    
    try {
      const driveTime = await getDriveTime(userPostcode, booking.postcode);
      
      console.log(`🚗 Drive time: ${userPostcode} → ${booking.postcode} = ${driveTime} minutes`);
      
      // If ANY existing booking is more than 45 min away, block ENTIRE day
      if (driveTime > maxDriveMinutes) {
        console.log(`❌ BLOCKING ENTIRE DAY: ${driveTime} min exceeds max ${maxDriveMinutes} min`);
        
        allSlots.forEach(slot => {
          slot.available = false;
          slot.reason = `Too far from existing booking at ${booking.startTime} (${driveTime} min drive)`;
        });
        
        return allSlots; // Return immediately - entire day blocked
      }
    } catch (error) {
      console.error('❌ Error calculating drive time:', error);
      // If we can't calculate drive time, be conservative and block the day
      allSlots.forEach(slot => {
        slot.available = false;
        slot.reason = 'Unable to verify drive time';
      });
      return allSlots;
    }
  }
  
  // STEP 2: User is within 45 min of all bookings, so now block the booked time slots
  console.log('\n✓ User is within 45 min of all existing bookings');
  console.log('Blocking booked time slots:\n');
  
  for (const booking of existingBookings) {
    const bookingStartMinutes = timeToMinutes(booking.startTime);
    const bookingEndMinutes = bookingStartMinutes + booking.duration;
    
    console.log(`  Booking: ${booking.startTime}-${minutesToTime(bookingEndMinutes)} (${booking.duration} min)`);
    
    allSlots.forEach(slot => {
      const slotMinutes = timeToMinutes(slot.time);
      
      // Block slots that fall within this booking's time range
      if (slotMinutes >= bookingStartMinutes && slotMinutes < bookingEndMinutes) {
        console.log(`    ❌ Blocking ${slot.time}`);
        slot.available = false;
        slot.reason = `Specialist already booked at ${booking.startTime}`;
      }
    });
  }
  
  const availableCount = allSlots.filter(s => s.available).length;
  console.log(`\n✓ Final result: ${availableCount} available, ${allSlots.length - availableCount} blocked\n`);
  
  return allSlots;
}

// Get drive time between two postcodes using Google Maps Distance Matrix API
async function getDriveTime(fromPostcode, toPostcode) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    console.warn('⚠ Google Maps API key not configured');
    throw new Error('Google Maps API key not configured');
  }
  
  try {
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
    
    // Return duration in minutes (use duration_in_traffic if available)
    const duration = element.duration_in_traffic || element.duration;
    const durationMinutes = Math.ceil(duration.value / 60);
    
    return durationMinutes;
    
  } catch (error) {
    console.error('Error getting drive time:', error);
    throw error;
  }
}

// Convert time string (HH:MM) to minutes since midnight
function timeToMinutes(timeString) {
  if (!timeString) return 0;
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

// Convert minutes to time string (HH:MM)
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}