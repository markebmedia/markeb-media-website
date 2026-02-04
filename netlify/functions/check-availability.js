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
    const { postcode, region, selectedDate, isAdmin, duration } = JSON.parse(event.body); // ✅ ADD duration

    if (!postcode || !region || !selectedDate) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: postcode, region, selectedDate' })
      };
    }

    // ✅ Default duration to 90 minutes if not provided
    const bookingDuration = duration || 90;
    console.log(`Checking availability for: postcode=${postcode}, region=${region}, date=${selectedDate}, duration=${bookingDuration}min`);

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
            available: false
          }))
        })
      };
    }

    // ✅ NEW: Fetch blocked times for this region and date
    const blockedTimes = await fetchBlockedTimes(region, selectedDate);
    console.log(`Found ${blockedTimes.length} blocked time(s) for this date/region`);

    // Fetch existing bookings from Airtable for this region and date
    const bookings = await fetchBookingsForRegion(region, selectedDate);
    console.log(`Found ${bookings.length} existing bookings for this date/region`);

    // ✅ If blocked times exist, apply them first
    let availableSlots;
    
    if (bookings.length === 0) {
      // No bookings - just check blocked times and duration
      availableSlots = generateAllTimeSlots();
      availableSlots = applyBlockedTimes(availableSlots, blockedTimes);
      availableSlots = applyDurationConstraints(availableSlots, bookingDuration, []); // ✅ Check duration even with no bookings
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          availableSlots: availableSlots,
          message: blockedTimes.length > 0 ? 'Some slots blocked by admin' : 'All slots available - no existing bookings',
          blockedTimesCount: blockedTimes.length
        })
      };
    }

    // Calculate available time slots based on existing bookings and drive times
    availableSlots = await calculateAvailableSlots(postcode, bookings, isAdmin, bookingDuration); // ✅ Pass duration
    
    // ✅ Apply blocked times on top of booking conflicts
    availableSlots = applyBlockedTimes(availableSlots, blockedTimes);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        availableSlots: availableSlots,
        existingBookings: bookings.length,
        blockedTimesCount: blockedTimes.length,
        region: region,
        debug: {
          selectedDate,
          requestedDuration: bookingDuration,
          bookingDetails: bookings.map(b => ({
            time: b.startTime,
            postcode: b.postcode,
            duration: b.duration
          })),
          blockedTimes: blockedTimes.map(bt => ({
            startTime: bt.startTime,
            endTime: bt.endTime,
            reason: bt.reason
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

// ✅ NEW: Fetch blocked times from Airtable
async function fetchBlockedTimes(region, selectedDate) {
  try {
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    // Capitalize region for Airtable (it stores "North" or "South")
    const capitalizedRegion = region.charAt(0).toUpperCase() + region.slice(1).toLowerCase();
    
    console.log(`Querying Blocked Times with:`);
    console.log(`  - Date: ${selectedDate}`);
    console.log(`  - Region: ${capitalizedRegion}`);
    
    const filterFormula = `AND(
      {Region} = '${capitalizedRegion}',
      IS_SAME({Date}, '${selectedDate}', 'day')
    )`;
    
    const records = await base('Blocked Times')
      .select({
        filterByFormula: filterFormula
      })
      .firstPage();

    console.log(`Retrieved ${records.length} blocked time(s) from Airtable`);

    const blockedTimes = records.map(record => {
      const blocked = {
        id: record.id,
        startTime: record.fields['Start Time'],
        endTime: record.fields['End Time'],
        reason: record.fields['Reason'] || 'Time blocked by admin',
        date: record.fields['Date'],
        region: record.fields['Region']
      };
      
      console.log(`  🚫 Blocked: ${blocked.startTime} - ${blocked.endTime} (${blocked.reason})`);
      
      return blocked;
    });

    return blockedTimes;

  } catch (error) {
    console.error('Error fetching blocked times from Airtable:', error);
    // Don't throw - just return empty array so bookings still work
    return [];
  }
}

// ✅ NEW: Apply blocked times to slots
function applyBlockedTimes(slots, blockedTimes) {
  if (blockedTimes.length === 0) return slots;
  
  console.log(`\nApplying ${blockedTimes.length} blocked time(s) to slots:`);
  
  blockedTimes.forEach(blocked => {
    const blockStartMinutes = timeToMinutes(blocked.startTime);
    const blockEndMinutes = timeToMinutes(blocked.endTime);
    
    console.log(`  Blocking ${blocked.startTime} - ${blocked.endTime}`);
    
    slots.forEach(slot => {
      const slotMinutes = timeToMinutes(slot.time);
      
      // Block slots that fall within the blocked time range
      if (slotMinutes >= blockStartMinutes && slotMinutes < blockEndMinutes) {
        console.log(`    ❌ Blocking ${slot.time}`);
        slot.available = false;
        slot.reason = blocked.reason;
      }
    });
  });
  
  return slots;
}

// ✅ NEW: Apply duration constraints - block slots where YOUR booking would overrun
function applyDurationConstraints(slots, bookingDuration, existingBookings) {
  console.log(`\nApplying duration constraints (${bookingDuration} min booking):`);
  
  const fixedBufferMinutes = 45;
  const endOfDayMinutes = timeToMinutes('15:30'); // Last possible end time
  
  slots.forEach(slot => {
    if (!slot.available) return; // Skip already blocked slots
    
    const slotStartMinutes = timeToMinutes(slot.time);
    const slotEndMinutes = slotStartMinutes + bookingDuration;
    const slotEndWithBuffer = slotEndMinutes + fixedBufferMinutes;
    
    // Check if booking would run past end of day
    if (slotEndMinutes > endOfDayMinutes) {
      console.log(`  ❌ ${slot.time}: Would finish at ${minutesToTime(slotEndMinutes)} (past 3:30 PM)`);
      slot.available = false;
      slot.reason = 'Booking would run past available hours';
      return;
    }
    
    // Check if booking + buffer would conflict with any existing booking
    for (const booking of existingBookings) {
      const bookingStartMinutes = timeToMinutes(booking.startTime);
      const bookingBufferStart = bookingStartMinutes - fixedBufferMinutes;
      
      // If YOUR booking end + buffer would overlap with existing booking's buffer start
      if (slotEndWithBuffer > bookingBufferStart && slotStartMinutes < bookingStartMinutes) {
        console.log(`  ❌ ${slot.time}: Would finish at ${minutesToTime(slotEndMinutes)} + buffer (${minutesToTime(slotEndWithBuffer)}), conflicts with booking at ${booking.startTime}`);
        slot.available = false;
        slot.reason = `Would conflict with booking at ${booking.startTime}`;
        return;
      }
    }
  });
  
  return slots;
}

// Fetch bookings from Airtable for specific region and date
async function fetchBookingsForRegion(region, selectedDate) {
  try {
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    // Capitalise region for Airtable (it stores "North" or "South")
    const capitalisedRegion = region.charAt(0).toUpperCase() + region.slice(1).toLowerCase();
    
    console.log(`Querying Airtable with:`);
    console.log(`  - Date: ${selectedDate}`);
    console.log(`  - Region: ${capitalisedRegion} (original: ${region})`);
    
    // Use Airtable's IS_SAME() function for date comparison
    const filterFormula = `AND(
  {Region} = '${capitalisedRegion}', 
  IS_SAME({Date}, '${selectedDate}', 'day'), 
  OR(
    {Booking Status} = 'Booked',
    {Booking Status} = 'Reserved',
    {Booking Status} = 'Confirmed'
  )
)`;
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
        duration: record.fields['Duration (mins)'] || 90,
        date: record.fields['Date'],
        region: record.fields['Region']
      };
      
      console.log(`  ✓ Booking: ${booking.startTime} at ${booking.postcode} (${booking.duration}min)`);
      
      return booking;
    });

    return bookings;

  } catch (error) {
    console.error('Error fetching bookings from Airtable:', error);
    throw error;
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
      if (hour === 15 && minute === 30) break; // Stop at 3:00 PM (last slot is 15:00)
      
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
async function calculateAvailableSlots(userPostcode, existingBookings, isAdmin, bookingDuration) { // ✅ Add bookingDuration parameter
  const allSlots = generateAllTimeSlots();
  const maxDriveMinutes = 45; // Max drive time to determine if booking can happen on this day
  const fixedBufferMinutes = 45; // Fixed buffer time before AND after each booking
  
  console.log(`\nCalculating availability for ${existingBookings.length} existing bookings with ${bookingDuration}min duration`);
  
  // STEP 1: Check if user's location is within 45 min drive of ALL existing bookings
  // This determines IF the booking can happen on this day
  for (const booking of existingBookings) {
    if (!booking.postcode) {
      console.log(`⚠ Skipping booking at ${booking.startTime} - no postcode available`);
      continue;
    }
    
    try {
      const driveTime = await getDriveTime(userPostcode, booking.postcode);
      
      console.log(`🚗 Drive time check: ${userPostcode} → ${booking.postcode} = ${driveTime} minutes`);
      
      // If ANY existing booking is more than 45 min away, block ENTIRE day
      if (driveTime > maxDriveMinutes) {
        console.log(`❌ BLOCKING ENTIRE DAY: Drive time (${driveTime} min) exceeds max (${maxDriveMinutes} min)`);
        
        allSlots.forEach(slot => {
          slot.available = false;
          slot.reason = `Too far from existing booking at ${booking.startTime} (${driveTime} min drive - max ${maxDriveMinutes} min)`;
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
  
  // STEP 2: User is within 45 min of all bookings
  // Now block: 45 min BEFORE + booking duration + 45 min AFTER
  console.log('\n✓ User is within 45 min of all existing bookings');
  console.log(`Blocking: ${fixedBufferMinutes} min before + booking + ${fixedBufferMinutes} min after:\n`);
  
  for (const booking of existingBookings) {
    const bookingStartMinutes = timeToMinutes(booking.startTime);
    const bookingEndMinutes = bookingStartMinutes + booking.duration;
    
    const bufferStartMinutes = bookingStartMinutes - fixedBufferMinutes; // 45 min BEFORE
    const bufferEndMinutes = bookingEndMinutes + fixedBufferMinutes;     // 45 min AFTER
    
    console.log(`  Buffer before: ${minutesToTime(bufferStartMinutes)}-${booking.startTime} (${fixedBufferMinutes} min)`);
    console.log(`  Booking: ${booking.startTime}-${minutesToTime(bookingEndMinutes)} (${booking.duration} min)`);
    console.log(`  Buffer after: ${minutesToTime(bookingEndMinutes)}-${minutesToTime(bufferEndMinutes)} (${fixedBufferMinutes} min)`);
    console.log(`  Total blocked: ${minutesToTime(bufferStartMinutes)}-${minutesToTime(bufferEndMinutes)}`);
    
    allSlots.forEach(slot => {
      const slotMinutes = timeToMinutes(slot.time);
      
      // Block slots that fall within: buffer before + booking + buffer after
      if (slotMinutes >= bufferStartMinutes && slotMinutes < bufferEndMinutes) {
        console.log(`    ❌ Blocking ${slot.time}`);
        slot.available = false;
        
        if (isAdmin) {
          if (slotMinutes < bookingStartMinutes) {
            slot.reason = `Buffer time before booking at ${booking.startTime}`;
          } else if (slotMinutes < bookingEndMinutes) {
            slot.reason = `Specialist already booked at ${booking.startTime}`;
          } else {
            slot.reason = `Buffer time after booking at ${booking.startTime}`;
          }
        }
      }
    });
  }
  
  // ✅ STEP 3: Apply duration constraints - check if YOUR booking would conflict
  allSlots = applyDurationConstraints(allSlots, bookingDuration, existingBookings);
  
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