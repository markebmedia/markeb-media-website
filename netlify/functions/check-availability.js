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
    const { postcode, territory, selectedDate } = JSON.parse(event.body);

    if (!postcode || !territory) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: postcode, territory' })
      };
    }

    // Fetch existing bookings from Airtable for this territory
    const bookings = await fetchBookingsForTerritory(territory, selectedDate);

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
        existingBookings: bookings.length
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

// Fetch bookings from Airtable for specific territory and date
async function fetchBookingsForTerritory(territory, selectedDate) {
  try {
    // Format date for Airtable filter (YYYY-MM-DD)
    const dateFilter = selectedDate ? `AND(IS_SAME({Shoot Date}, '${selectedDate}', 'day'), {Territory} = '${territory}', {Status} = 'Booked')` : `AND({Territory} = '${territory}', {Status} = 'Booked')`;

    const airtableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Active%20Bookings?filterByFormula=${encodeURIComponent(dateFilter)}`;

    const response = await fetch(airtableUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch bookings from Airtable');
    }

    const data = await response.json();
    
    // Extract relevant booking info
    return data.records.map(record => ({
      id: record.id,
      postcode: extractPostcode(record.fields['Project Address']),
      startTime: extractTime(record.fields['Shoot Date']),
      duration: record.fields['Duration'] || 90, // Default 90 mins if not specified
      date: record.fields['Shoot Date']
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

// Extract time from datetime string
function extractTime(datetimeString) {
  if (!datetimeString) return null;
  
  const date = new Date(datetimeString);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
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

// Calculate available time slots based on drive times
async function calculateAvailableSlots(userPostcode, existingBookings) {
  const allSlots = generateAllTimeSlots();
  
  // For each existing booking, calculate drive time and block unavailable slots
  for (const booking of existingBookings) {
    if (!booking.postcode || !booking.startTime) continue;
    
    try {
      // Get drive time from existing booking location to user's location
      const driveTimeMinutes = await getDriveTime(booking.postcode, userPostcode);
      
      // Calculate when photographer finishes existing shoot
      const bookingStartMinutes = timeToMinutes(booking.startTime);
      const shootEndMinutes = bookingStartMinutes + booking.duration;
      const bufferMinutes = 15; // 15-minute buffer for pack/unpack
      const earliestNextStart = shootEndMinutes + driveTimeMinutes + bufferMinutes;
      
      // Block all slots before this time
      allSlots.forEach(slot => {
        const slotMinutes = timeToMinutes(slot.time);
        
        if (slotMinutes < earliestNextStart) {
          slot.available = false;
          slot.reason = 'Too close to previous booking';
        }
      });
      
    } catch (error) {
      console.error('Error calculating drive time:', error);
      // If drive time calculation fails, be conservative and block early slots
      const bookingStartMinutes = timeToMinutes(booking.startTime);
      const conservativeBuffer = bookingStartMinutes + booking.duration + 120; // 2 hours buffer
      
      allSlots.forEach(slot => {
        const slotMinutes = timeToMinutes(slot.time);
        if (slotMinutes < conservativeBuffer) {
          slot.available = false;
          slot.reason = 'Unable to calculate drive time';
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
    throw new Error('Google Maps API key not configured');
  }
  
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(fromPostcode)}&destinations=${encodeURIComponent(toPostcode)}&units=imperial&key=${apiKey}`;
  
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
  
  // Return duration in minutes
  const durationMinutes = Math.ceil(element.duration.value / 60);
  
  return durationMinutes;
}

// Convert time string (HH:MM) to minutes since midnight
function timeToMinutes(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}