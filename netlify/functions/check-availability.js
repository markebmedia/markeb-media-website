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

    // Fetch existing bookings from Airtable for this region and date
    const bookings = await fetchBookingsForRegion(region, selectedDate);

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

// Fetch bookings from Airtable for specific region and date
async function fetchBookingsForRegion(region, selectedDate) {
  try {
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(process.env.AIRTABLE_BASE_ID);

    // Query bookings for this specific region and date
    const records = await base('Bookings')
      .select({
        filterByFormula: `AND({Region} = '${region}', {Date} = '${selectedDate}', {Status} = 'Booked')`,
        sort: [{ field: 'Time', direction: 'asc' }]
      })
      .firstPage();

    // Extract relevant booking info
    return records.map(record => ({
      id: record.id,
      postcode: record.fields['Postcode'] || extractPostcode(record.fields['Property Address']),
      startTime: record.fields['Time'],
      duration: record.fields['Duration'] || 90, // Default 90 mins if not specified
      date: record.fields['Date'],
      region: record.fields['Region']
    }));

  } catch (error) {
    console.error('Error fetching bookings:', error);
    return [];
  }
}

// Extract postcode from address string
function extractPostcode(address) {
  if (!address) return '';
  
  // UK postcode regex pattern
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

// Calculate available time slots based on drive times between bookings
async function calculateAvailableSlots(userPostcode, existingBookings) {
  const allSlots = generateAllTimeSlots();
  
  // Sort bookings by start time
  existingBookings.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  
  // For each existing booking, calculate drive time and block unavailable slots
  for (const booking of existingBookings) {
    if (!booking.postcode || !booking.startTime) continue;
    
    try {
      // Get drive time from existing booking location to user's location
      const driveTimeMinutes = await getDriveTime(booking.postcode, userPostcode);
      
      // Calculate when mediaspecialist finishes existing shoot
      const bookingStartMinutes = timeToMinutes(booking.startTime);
      const shootEndMinutes = bookingStartMinutes + booking.duration;
      const bufferMinutes = 15; // 15-minute buffer for pack/unpack
      const earliestNextStart = shootEndMinutes + driveTimeMinutes + bufferMinutes;
      
      // Block all slots before earliest possible next start
      allSlots.forEach(slot => {
        const slotMinutes = timeToMinutes(slot.time);
        
        // Block slots that are too early after this booking
        if (slotMinutes < earliestNextStart) {
          slot.available = false;
          slot.reason = `Too close to ${booking.startTime} booking (${driveTimeMinutes} min drive time needed)`;
        }
      });
      
      // Also check if user's booking would conflict with NEXT booking
      // Find next booking after current one
      const nextBooking = existingBookings.find(b => 
        timeToMinutes(b.startTime) > bookingStartMinutes
      );
      
      if (nextBooking) {
        // Calculate drive time from user's location to next booking
        const driveToNextMinutes = await getDriveTime(userPostcode, nextBooking.postcode);
        const nextBookingStart = timeToMinutes(nextBooking.startTime);
        
        // Block slots where user's booking would end too late to reach next booking
        allSlots.forEach(slot => {
          const slotMinutes = timeToMinutes(slot.time);
          
          // Assume user's booking duration (we don't know it yet, so use conservative estimate)
          const estimatedUserDuration = 90; // Conservative estimate
          const userBookingEnd = slotMinutes + estimatedUserDuration + bufferMinutes;
          const arrivalAtNext = userBookingEnd + driveToNextMinutes;
          
          // If can't reach next booking in time, block this slot
          if (arrivalAtNext > nextBookingStart) {
            slot.available = false;
            slot.reason = `Would conflict with ${nextBooking.startTime} booking`;
          }
        });
      }
      
    } catch (error) {
      console.error('Error calculating drive time for booking:', booking.id, error);
      // If drive time calculation fails, be conservative and block slots around this booking
      const bookingStartMinutes = timeToMinutes(booking.startTime);
      const conservativeBuffer = 120; // 2 hours buffer
      
      allSlots.forEach(slot => {
        const slotMinutes = timeToMinutes(slot.time);
        // Block slots within 2 hours before booking
        if (Math.abs(slotMinutes - bookingStartMinutes) < conservativeBuffer) {
          slot.available = false;
          slot.reason = 'Conservative buffer (drive time unavailable)';
        }
      });
    }
  }
  
  return allSlots;
}

// Get drive time between two postcodes using Google Maps Distance Matrix API
async function getDriveTime(fromPostcode, toPostcode) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    console.warn('Google Maps API key not configured - using fallback estimate');
    // Fallback: estimate 30 minutes drive time
    return 30;
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
      console.warn('No route found between locations - using fallback');
      return 30; // Fallback estimate
    }
    
    // Return duration in minutes (use duration_in_traffic if available)
    const duration = element.duration_in_traffic || element.duration;
    const durationMinutes = Math.ceil(duration.value / 60);
    
    console.log(`Drive time from ${fromPostcode} to ${toPostcode}: ${durationMinutes} minutes`);
    
    return durationMinutes;
  } catch (error) {
    console.error('Error getting drive time:', error);
    return 30; // Fallback estimate
  }
}

// Convert time string (HH:MM) to minutes since midnight
function timeToMinutes(timeString) {
  if (!timeString) return 0;
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}