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

    if (!postcode || !region) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: postcode, region' })
      };
    }

    console.log(`Checking availability for: postcode=${postcode}, region=${region}, date=${selectedDate}`);

    // Fetch existing bookings from Airtable for this region and date
    const bookings = await fetchBookingsForRegion(region, selectedDate);

    console.log(`Found ${bookings.length} existing bookings for this date/region`);

    // If no bookings exist for this date, all time slots are available
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
        region: region
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

// Helper function to format date to match Airtable's UK format (D/M/YYYY)
function formatDateForAirtable(dateString) {
  // Handle various input formats and convert to D/M/YYYY
  let date;
  
  // If it's already in D/M/YYYY or DD/MM/YYYY format, parse it correctly
  if (dateString.includes('/')) {
    const parts = dateString.split('/');
    // Assume DD/MM/YYYY or D/M/YYYY format
    date = new Date(parts[2], parts[1] - 1, parts[0]);
  } else {
    // Assume ISO format YYYY-MM-DD
    date = new Date(dateString);
  }
  
  // Return in D/M/YYYY format (no leading zeros)
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  
  return `${day}/${month}/${year}`;
}

// Fetch bookings from Airtable for specific region and date
async function fetchBookingsForRegion(region, selectedDate) {
  try {
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    // Format the date to match Airtable's format (D/M/YYYY)
    const formattedDate = formatDateForAirtable(selectedDate);
    
    console.log(`Formatted date for Airtable: ${formattedDate} (original: ${selectedDate})`);
    console.log(`Filter formula: AND({Region} = '${region}', {Date} = '${formattedDate}', {Booking Status} = 'Booked')`);

    // Query bookings for this specific region and date
    const records = await base('Bookings')
      .select({
        filterByFormula: `AND({Region} = '${region}', {Date} = '${formattedDate}', {Booking Status} = 'Booked')`,
        sort: [{ field: 'Time', direction: 'asc' }]
      })
      .firstPage();

    console.log(`Retrieved ${records.length} records from Airtable`);

    // Extract relevant booking info
    const bookings = records.map(record => {
      const booking = {
        id: record.id,
        postcode: record.fields['Postcode'] || extractPostcode(record.fields['Property Address']),
        startTime: record.fields['Time'],
        duration: record.fields['Duration'] || 90,
        date: record.fields['Date'],
        region: record.fields['Region']
      };
      
      console.log(`Booking found: ${booking.startTime} at ${booking.postcode} (Duration: ${booking.duration}min)`);
      
      return booking;
    });

    return bookings;

  } catch (error) {
    console.error('Error fetching bookings:', error);
    return [];
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
  
  console.log(`Calculating availability for ${existingBookings.length} existing bookings`);
  
  // STEP 1: Check if user's location is within 45 min drive of ALL existing bookings
  for (const booking of existingBookings) {
    if (!booking.postcode) {
      console.log(`Skipping booking at ${booking.startTime} - no postcode available`);
      continue;
    }
    
    try {
      const driveTime = await getDriveTime(userPostcode, booking.postcode);
      
      console.log(`Drive time from user (${userPostcode}) to existing booking (${booking.postcode}): ${driveTime} minutes`);
      
      // If ANY existing booking is more than 45 min away, block ENTIRE day
      if (driveTime > maxDriveMinutes) {
        console.log(`BLOCKING ENTIRE DAY: Drive time (${driveTime} min) exceeds max (${maxDriveMinutes} min)`);
        
        allSlots.forEach(slot => {
          slot.available = false;
          slot.reason = `Too far from existing booking at ${booking.startTime} (${driveTime} min drive - max ${maxDriveMinutes} min allowed)`;
        });
        
        return allSlots; // Return immediately - entire day blocked
      }
    } catch (error) {
      console.error('Error calculating drive time:', error);
      // If we can't calculate drive time, be conservative and block the day
      allSlots.forEach(slot => {
        slot.available = false;
        slot.reason = 'Unable to verify drive time - day blocked for safety';
      });
      return allSlots;
    }
  }
  
  // STEP 2: User is within 45 min of all bookings, so now just block the actual booked time slots
  console.log('User is within 45 min of all existing bookings - blocking only booked time slots');
  
  for (const booking of existingBookings) {
    const bookingStartMinutes = timeToMinutes(booking.startTime);
    const bookingEndMinutes = bookingStartMinutes + booking.duration;
    
    console.log(`Blocking slots from ${booking.startTime} (${bookingStartMinutes} min) to ${bookingEndMinutes} min (${booking.duration} min duration)`);
    
    allSlots.forEach(slot => {
      const slotMinutes = timeToMinutes(slot.time);
      
      // Block slots that fall within this booking's time range
      if (slotMinutes >= bookingStartMinutes && slotMinutes < bookingEndMinutes) {
        console.log(`  -> Blocking slot ${slot.time} (${slotMinutes} min)`);
        slot.available = false;
        slot.reason = `Media specialist already booked at ${booking.startTime}`;
      }
    });
  }
  
  const availableCount = allSlots.filter(s => s.available).length;
  console.log(`Final result: ${availableCount} available slots, ${allSlots.length - availableCount} blocked slots`);
  
  return allSlots;
}

// Get drive time between two postcodes using Google Maps Distance Matrix API
async function getDriveTime(fromPostcode, toPostcode) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    console.warn('Google Maps API key not configured - blocking day for safety');
    throw new Error('Google Maps API key not configured');
  }
  
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(fromPostcode)}&destinations=${encodeURIComponent(toPostcode)}&mode=driving&departure_time=now&key=${apiKey}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error('Google Maps API request failed');
    }
    
    const data = await response.json();
    
    if (data.status !== 'OK') {
      throw new Error(`Google Maps API error: ${data.status}`);
    }
    
    const element = data.rows[0]?.elements[0];
    
    if (!element || element.status !== 'OK') {
      throw new Error('No route found between locations');
    }
    
    // Return duration in minutes (use duration_in_traffic if available)
    const duration = element.duration_in_traffic || element.duration;
    const durationMinutes = Math.ceil(duration.value / 60);
    
    return durationMinutes;
    
  } catch (error) {
    console.error('Error getting drive time:', error);
    throw error; // Propagate error so we can block the day
  }
}

// Convert time string (HH:MM) to minutes since midnight
function timeToMinutes(timeString) {
  if (!timeString) return 0;
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}