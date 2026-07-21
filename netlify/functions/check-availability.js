const fetch = require('node-fetch');

// ── SPECIALIST ROSTER ────────────────────────────────────────────────────────
// Availability is checked per specialist not per region, so a booking in
// 'north' and a booking in 'north-west' both block James Jago's diary.
// To reassign a region: change the name value on that line only.
// To add a new person: add their region keys here with their name.
const SPECIALIST_REGIONS = {
  'north':      ['Jodie', 'James Jago'],
  'north-west': ['James Jago'],
  'north-east': ['James Jago'],
  'west':       ['James Jago'],
  'east':       ['Andrii'],
  'south':      ['Andrii'],
  'south-east': ['Andrii'],
  'south-west': ['Andrii']
};

// Maps specialist name → their Services array, populated fresh each request
// so the response can tell the frontend which services this creator covers.
let creatorServicesCache = {};

// ── CREATOR NETWORK OVERRIDE ──────────────────────────────────────────────
// If any Active creator has an Active region assignment for this region,
// they fully replace the in-house specialist(s) — this is a deliberate
// override, not an additional fallback layer. In-house only applies when
// zero creators are assigned to a region.
async function getCreatorNetworkOverride(regionKey) {
  try {
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    const assignments = await base('Creator Region Assignments')
      .select({
        filterByFormula: `AND({Region} = '${regionKey}', {Active} = TRUE())`,
        sort: [{ field: 'Priority', direction: 'asc' }]
      })
      .all();

    if (assignments.length === 0) return null;

    const creatorNames = [];
    for (const record of assignments) {
      const linkedIds = record.fields['Creator'] || [];
      if (linkedIds.length === 0) continue;

      const creatorRecord = await base('Creator Network').find(linkedIds[0]);
      if (creatorRecord.fields['Status'] === 'Active') {
        const name = creatorRecord.fields['Name'];
        creatorNames.push(name);
        creatorServicesCache[name] = creatorRecord.fields['Services'] || [];
      }
    }

    return creatorNames.length > 0 ? creatorNames : null;

  } catch (err) {
    console.error('Error checking Creator Network override — falling back to in-house:', err);
    return null;
  }
}

async function getSpecialistsForRegion(regionKey) {
  const key = (regionKey || '').toLowerCase();

  const creatorOverride = await getCreatorNetworkOverride(key);
  if (creatorOverride) {
    console.log(`Region ${key}: using Creator Network override — ${creatorOverride.join(', ')}`);
    return creatorOverride;
  }

  return SPECIALIST_REGIONS[key] || [];
}

// Backwards-compatible helper — returns the primary (first) specialist only.
// Used anywhere that still expects a single name.
async function getSpecialistName(regionKey) {
  const list = await getSpecialistsForRegion(regionKey);
  return list.length > 0 ? list[0] : null;
}

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { postcode, region, selectedDate, isAdmin, duration } = JSON.parse(event.body);

    if (!postcode || !region || !selectedDate) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: postcode, region, selectedDate' })
      };
    }

    // ✅ Default duration to 90 minutes if not provided
    const bookingDuration = duration || 90;
    creatorServicesCache = {}; // reset per-invocation — avoids stale data on warm lambda reuse
    console.log(`Checking availability for: postcode=${postcode}, region=${region}, date=${selectedDate}, duration=${bookingDuration}min`);

    // ── DATE GATE ────────────────────────────────────────────────────────────
    // Next-day bookings allowed if request arrives before 5pm today.
    // All other bookings require more than 24 hours notice.
    const now = new Date();

    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    const tomorrowMidnight = new Date(todayMidnight);
    tomorrowMidnight.setDate(todayMidnight.getDate() + 1);

    const selectedMidnight = new Date(selectedDate + 'T00:00:00');
    const isNextDay = selectedMidnight.getTime() === tomorrowMidnight.getTime();
    const currentHour = now.getHours();

    let blockAllSlots = false;
    let blockReason = '';

    if (isNextDay) {
      if (currentHour >= 18) {
        blockAllSlots = true;
        blockReason = 'Next-day bookings must be made before 5pm';
        console.log('Next-day booking request after 5pm — blocking all slots');
      } else {
        console.log(`Next-day booking request at ${currentHour}:xx — permitted (before 5pm)`);
      }
    } else {
      const hoursDifference = (selectedMidnight - now) / (1000 * 60 * 60);
      if (hoursDifference < 24) {
        blockAllSlots = true;
        blockReason = 'Bookings require at least 24 hours notice';
        console.log(`Date is within 24 hours (${hoursDifference.toFixed(1)} hours) — blocking all slots`);
      }
    }

    if (blockAllSlots) {
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
            reason: blockReason
          }))
        })
      };
    }
    // ────────────────────────────────────────────────────────────────────────

    // ✅ Try each specialist assigned to this region, in priority order,
    // and use the first one who has at least one available slot that day.
    const candidateSpecialists = await getSpecialistsForRegion(region);

    if (candidateSpecialists.length === 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: `No specialist found for region: ${region}` })
      };
    }

    let chosenSpecialist = null;
    let finalSlots = null;
    let finalBookings = [];
    let finalBlockedTimes = [];

    for (const specialistName of candidateSpecialists) {
      console.log(`\n=== Trying specialist: ${specialistName} ===`);

      const blockedTimes = await fetchBlockedTimes(specialistName, selectedDate);
      console.log(`Found ${blockedTimes.length} blocked time(s) for ${specialistName} on this date`);

      const bookings = await fetchBookingsForSpecialist(specialistName, selectedDate);
      console.log(`Found ${bookings.length} existing bookings for ${specialistName} on this date`);

      let slots;

      if (bookings.length === 0) {
        slots = generateAllTimeSlots();
        slots = applyBlockedTimes(slots, blockedTimes);
        slots = applyDurationConstraints(slots, bookingDuration, []);
      } else {
        slots = await calculateAvailableSlots(postcode, bookings, isAdmin, bookingDuration);
        slots = applyBlockedTimes(slots, blockedTimes);
      }

      const hasAvailability = slots.some(s => s.available);

      if (hasAvailability) {
        console.log(`✓ ${specialistName} has availability — using this specialist`);
        chosenSpecialist = specialistName;
        finalSlots = slots;
        finalBookings = bookings;
        finalBlockedTimes = blockedTimes;
        break;
      }

      console.log(`✗ ${specialistName} has no availability on this date — trying next fallback if any`);
    }

    // If nobody in the fallback chain has availability, return the last
    // checked specialist's (fully blocked) slots so the UI can show why.
    if (!chosenSpecialist) {
      console.log(`No specialist in [${candidateSpecialists.join(', ')}] has availability on ${selectedDate}`);
      const lastResortSlots = generateAllTimeSlots().map(slot => ({
        ...slot,
        available: false,
        reason: 'No specialist available for this region on this date'
      }));

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          availableSlots: lastResortSlots,
          region: region,
          candidatesChecked: candidateSpecialists
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        availableSlots: finalSlots,
        assignedSpecialist: chosenSpecialist,
        assignedSpecialistServices: creatorServicesCache[chosenSpecialist] || null,
        existingBookings: finalBookings.length,
        blockedTimesCount: finalBlockedTimes.length,
        region: region,
        candidatesChecked: candidateSpecialists,
        debug: {
          selectedDate,
          requestedDuration: bookingDuration,
          bookingDetails: finalBookings.map(b => ({
            time: b.startTime,
            postcode: b.postcode,
            duration: b.duration
          })),
          blockedTimes: finalBlockedTimes.map(bt => ({
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

// ✅ Fetch blocked times from Airtable for a specific specialist by name
async function fetchBlockedTimes(specialistName, selectedDate) {
  try {
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    console.log(`Querying Blocked Times with:`);
    console.log(`  - Date: ${selectedDate}`);
    console.log(`  - Specialist: ${specialistName}`);

    const filterFormula = `AND(
      FIND('${specialistName}', {Media Specialist}),
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

// ✅ Apply blocked times to slots
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

// ✅ Apply duration constraints - block slots where YOUR booking would overrun
function applyDurationConstraints(slots, bookingDuration, existingBookings) {
  console.log(`\nApplying duration constraints (${bookingDuration} min booking):`);
  
  const fixedBufferMinutes = 45;
  const endOfDayMinutes = timeToMinutes('16:30'); // Last booking starts 15:00, max 90min + 45min buffer
  
  slots.forEach(slot => {
    if (!slot.available) return; // Skip already blocked slots
    
    const slotStartMinutes = timeToMinutes(slot.time);
    const slotEndMinutes = slotStartMinutes + bookingDuration;
    const slotEndWithBuffer = slotEndMinutes + fixedBufferMinutes;
    
    // Block slots past the last bookable start time
    if (slotStartMinutes > timeToMinutes('15:00')) {
      console.log(`  ❌ ${slot.time}: Past last bookable slot (15:00)`);
      slot.available = false;
      slot.reason = 'Past last available booking time';
      return;
    }

    // Check if booking would run past end of day
    if (slotEndMinutes > endOfDayMinutes) {
      console.log(`  ❌ ${slot.time}: Would finish at ${minutesToTime(slotEndMinutes)} (past 4:30 PM)`);
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

// Fetch bookings from Airtable for a specific specialist by name
async function fetchBookingsForSpecialist(specialistName, selectedDate) {
  try {
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    console.log(`Querying Airtable with:`);
    console.log(`  - Date: ${selectedDate}`);
    console.log(`  - Specialist: ${specialistName}`);

    const filterFormula = `AND(
  FIND('${specialistName}', {Media Specialist}),
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
    for (let minute of [0, 15, 30, 45]) {
      if (hour === 15 && minute === 15) break; // Stop at 15:00 (last slot is 15:00)
      
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
async function calculateAvailableSlots(userPostcode, existingBookings, isAdmin, bookingDuration) {
  let allSlots = generateAllTimeSlots(); // ✅ CHANGED: const → let
  const maxDriveMinutes = 45;
  const fixedBufferMinutes = 45;
  
  console.log(`\nCalculating availability for ${existingBookings.length} existing bookings with ${bookingDuration}min duration`);
  
  // STEP 1: Check if user's location is within 45 min drive of ALL existing bookings
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
        
        return allSlots;
      }
    } catch (error) {
      console.error('❌ Error calculating drive time:', error);
      allSlots.forEach(slot => {
        slot.available = false;
        slot.reason = 'Unable to verify drive time';
      });
      return allSlots;
    }
  }
  
  // STEP 2: User is within 45 min of all bookings
  console.log('\n✓ User is within 45 min of all existing bookings');
  console.log(`Blocking: ${fixedBufferMinutes} min before + booking + ${fixedBufferMinutes} min after:\n`);
  
  for (const booking of existingBookings) {
    const bookingStartMinutes = timeToMinutes(booking.startTime);
    const bookingEndMinutes = bookingStartMinutes + booking.duration;
    
    const bufferStartMinutes = bookingStartMinutes - fixedBufferMinutes;
    const bufferEndMinutes = bookingEndMinutes + fixedBufferMinutes;
    
    console.log(`  Buffer before: ${minutesToTime(bufferStartMinutes)}-${booking.startTime} (${fixedBufferMinutes} min)`);
    console.log(`  Booking: ${booking.startTime}-${minutesToTime(bookingEndMinutes)} (${booking.duration} min)`);
    console.log(`  Buffer after: ${minutesToTime(bookingEndMinutes)}-${minutesToTime(bufferEndMinutes)} (${fixedBufferMinutes} min)`);
    console.log(`  Total blocked: ${minutesToTime(bufferStartMinutes)}-${minutesToTime(bufferEndMinutes)}`);
    
    allSlots.forEach(slot => {
      const slotMinutes = timeToMinutes(slot.time);
      
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
  
  // ✅ STEP 3: Apply duration constraints
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