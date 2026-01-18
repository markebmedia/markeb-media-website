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
  const bufferMinutes = 15; // 15-minute buffer for pack/unpack
  const estimatedUserDuration = 90; // Conservative estimate for user's booking
  
  // Sort bookings by start time
  existingBookings.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  
  // STEP 1: Block slots that overlap with existing bookings or are too soon after them
  for (const booking of existingBookings) {
    if (!booking.postcode || !booking.startTime) continue;
    
    try {
      // Calculate when media specialist finishes existing shoot
      const bookingStartMinutes = timeToMinutes(booking.startTime);
      const shootEndMinutes = bookingStartMinutes + booking.duration;
      
      // Get drive time from existing booking location to user's location
      const driveTimeMinutes = await getDriveTime(booking.postcode, userPostcode);
      
      // CRITICAL CHECK: If drive time exceeds 45 minutes, block ALL remaining slots
      // The media specialist can't travel that far between bookings
      if (driveTimeMinutes > 45) {
        allSlots.forEach(slot => {
          const slotMinutes = timeToMinutes(slot.time);
          // Only block slots that come after this booking ends
          if (slotMinutes >= shootEndMinutes) {
            slot.available = false;
            slot.reason = `Too far from ${booking.startTime} booking (${driveTimeMinutes} min drive - max 45 min allowed)`;
          }
        });
        continue; // Skip to next booking
      }
      
      const earliestNextStart = shootEndMinutes + driveTimeMinutes + bufferMinutes;
      
      // Block all slots that overlap with or are too soon after this booking
      allSlots.forEach(slot => {
        const slotMinutes = timeToMinutes(slot.time);
        
        // CASE 1: Block slots during the existing booking
        if (slotMinutes >= bookingStartMinutes && slotMinutes < shootEndMinutes) {
          slot.available = false;
          slot.reason = `Media specialist has booking at ${booking.startTime}`;
        }
        // CASE 2: Block slots after booking but before media specialist can arrive
        // (not enough time for drive + buffer)
        else if (slotMinutes < earliestNextStart) {
          slot.available = false;
          slot.reason = `Not enough time to travel from ${booking.startTime} booking (${driveTimeMinutes} min drive + ${bufferMinutes} min buffer needed)`;
        }
      });
      
    } catch (error) {
      console.error('Error calculating drive time from booking:', booking.id, error);
      // If drive time calculation fails, be conservative and block slots around this booking
      const bookingStartMinutes = timeToMinutes(booking.startTime);
      const shootEndMinutes = bookingStartMinutes + (booking.duration || 90);
      const conservativeBuffer = 60; // 1 hour buffer after booking ends
      
      allSlots.forEach(slot => {
        const slotMinutes = timeToMinutes(slot.time);
        
        // Block the actual booking time
        if (slotMinutes >= bookingStartMinutes && slotMinutes < shootEndMinutes) {
          slot.available = false;
          slot.reason = `Media specialist has booking at ${booking.startTime}`;
        }
        // Block slots within 1 hour after booking ends
        else if (slotMinutes >= shootEndMinutes && slotMinutes < shootEndMinutes + conservativeBuffer) {
          slot.available = false;
          slot.reason = 'Conservative buffer (drive time unavailable)';
        }
      });
    }
  }
  
  // STEP 2: For each remaining available slot, check if media specialist can reach ALL future bookings from user's location
  for (const slot of allSlots) {
    if (!slot.available) continue; // Skip if already blocked
    
    const slotMinutes = timeToMinutes(slot.time);
    
    // Check all existing bookings that come AFTER this time slot
    for (const futureBooking of existingBookings) {
      const futureBookingStart = timeToMinutes(futureBooking.startTime);
      
      // Only check bookings that are after this slot
      if (futureBookingStart <= slotMinutes) continue;
      
      try {
        // Calculate drive time from user's location to the future booking
        const driveToFutureMinutes = await getDriveTime(userPostcode, futureBooking.postcode);
        
        // CRITICAL CHECK: If drive time exceeds 45 minutes, block this slot
        // The media specialist can't travel that far between bookings
        if (driveToFutureMinutes > 45) {
          slot.available = false;
          slot.reason = `Next booking is too far away (${driveToFutureMinutes} min drive - max 45 min allowed)`;
          break; // No need to check other future bookings for this slot
        }
        
        // Calculate when user's booking would end
        const userBookingEnd = slotMinutes + estimatedUserDuration + bufferMinutes;
        const arrivalAtFuture = userBookingEnd + driveToFutureMinutes;
        
        // If media specialist can't reach the future booking in time, block this slot
        if (arrivalAtFuture > futureBookingStart) {
          slot.available = false;
          slot.reason = `Would conflict with ${futureBooking.startTime} booking (need ${driveToFutureMinutes} min to travel there)`;
          break; // No need to check other future bookings for this slot
        }
      } catch (error) {
        console.error('Error calculating drive time to future booking:', futureBooking.id, error);
        // Be conservative - if we can't calculate drive time, block slots close to the future booking
        const timeDifference = futureBookingStart - slotMinutes;
        if (timeDifference < estimatedUserDuration + 60) { // Less than estimated duration + 1 hour buffer
          slot.available = false;
          slot.reason = `May conflict with ${futureBooking.startTime} booking (drive time unavailable)`;
          break;
        }
      }
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