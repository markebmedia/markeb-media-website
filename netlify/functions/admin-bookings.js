// netlify/functions/admin-bookings.js
// Admin function to retrieve all bookings with customer information and drive times
exports.handler = async (event, context) => {
  console.log('=== Admin Bookings Function ===');
  console.log('Method:', event.httpMethod);
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

  // Check environment variables
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    console.error('Missing required environment variables');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, message: 'Server configuration error' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { startDate, endDate, region, status, paymentStatus } = body;

    // Build filter formula
    let filters = [];
    
    if (startDate && endDate) {
      filters.push(`AND(IS_AFTER({Date}, '${startDate}'), IS_BEFORE({Date}, '${endDate}'))`);
    }
    
    if (region) {
      filters.push(`{Region} = '${region}'`);
    }
    
    if (status) {
      filters.push(`{Booking Status} = '${status}'`);
    }
    
    // Handle payment status - look for "Reserved", "Pending", OR BLANK/EMPTY
    if (paymentStatus) {
      if (paymentStatus === 'Reserved') {
        // Look for "Reserved", "Pending", OR empty/blank Payment Status
        filters.push(`OR({Payment Status} = 'Reserved', {Payment Status} = 'Pending', {Payment Status} = BLANK())`);
      } else {
        filters.push(`{Payment Status} = '${paymentStatus}'`);
      }
    }

    const filterFormula = filters.length > 0 
      ? `AND(${filters.join(', ')})` 
      : '';

    // Fetch bookings from Airtable
    const bookingsUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Bookings?${filterFormula ? `filterByFormula=${encodeURIComponent(filterFormula)}&` : ''}sort[0][field]=Date&sort[0][direction]=desc&sort[1][field]=Time&sort[1][direction]=asc`;
    
    const bookingsResponse = await fetch(bookingsUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!bookingsResponse.ok) {
      throw new Error(`Airtable API error: ${bookingsResponse.status}`);
    }

    const bookingsData = await bookingsResponse.json();
    const bookings = bookingsData.records || [];

    // Fetch customer data for each unique email
    const uniqueEmails = [...new Set(bookings.map(b => b.fields['Client Email']).filter(Boolean))];
    
    const customersMap = {};
    
    if (uniqueEmails.length > 0) {
      // Fetch all customers
      const usersUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE || 'Markeb Media Users'}`;
      
      const usersResponse = await fetch(usersUrl, {
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        const users = usersData.records || [];
        
        // Create a map of email -> customer data
        users.forEach(user => {
          const email = user.fields['Email'];
          if (email) {
            customersMap[email.toLowerCase()] = {
              id: user.id,
              name: user.fields['Name'],
              company: user.fields['Company'],
              region: user.fields['Region'],
              accountStatus: user.fields['Account Status'],
              allowReserve: user.fields['Allow Reserve Without Payment'] === true
            };
          }
        });
      }
    }

    // Calculate drive times between same-day bookings
    const bookingsWithDriveTimes = await calculateDriveTimes(bookings);

    // Enhance bookings with customer data
    const enhancedBookings = bookingsWithDriveTimes.map(booking => {
      const clientEmail = booking.fields['Client Email'];
      const customer = clientEmail ? customersMap[clientEmail.toLowerCase()] : null;
      
      return {
        ...booking,
        customerData: customer || null,
        hasAccount: !!customer,
        canReserve: customer?.allowReserve || false
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        bookings: enhancedBookings,
        total: enhancedBookings.length,
        stats: {
          total: enhancedBookings.length,
          withAccount: enhancedBookings.filter(b => b.hasAccount).length,
          withoutAccount: enhancedBookings.filter(b => !b.hasAccount).length,
          paid: enhancedBookings.filter(b => b.fields['Payment Status'] === 'Paid').length,
          reserved: enhancedBookings.filter(b => 
            b.fields['Payment Status'] === 'Reserved' || 
            b.fields['Payment Status'] === 'Pending' || 
            !b.fields['Payment Status']
          ).length,
          cancelled: enhancedBookings.filter(b => b.fields['Booking Status'] === 'Cancelled').length,
          upcoming: enhancedBookings.filter(b => {
            const bookingDate = new Date(b.fields['Date']);
            return bookingDate >= new Date() && b.fields['Booking Status'] !== 'Cancelled';
          }).length
        }
      })
    };

  } catch (error) {
    console.error('Error fetching bookings:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        message: 'Failed to load bookings',
        error: error.message 
      })
    };
  }
};

// Calculate drive times between bookings on the same day
async function calculateDriveTimes(bookings) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn('Google Maps API key not configured - skipping drive time calculations');
    return bookings.map(b => ({ ...b, driveTimeInfo: null }));
  }

  // Group bookings by date and region
  const bookingsByDateAndRegion = {};
  
  bookings.forEach(booking => {
    const date = booking.fields['Date'];
    const region = booking.fields['Region'];
    const key = `${date}-${region}`;
    
    if (!bookingsByDateAndRegion[key]) {
      bookingsByDateAndRegion[key] = [];
    }
    
    bookingsByDateAndRegion[key].push(booking);
  });

  // Calculate drive times for each group
  const results = [];
  
  for (const [key, dayBookings] of Object.entries(bookingsByDateAndRegion)) {
    // Sort by time
    dayBookings.sort((a, b) => {
      const timeA = a.fields['Time'] || '00:00';
      const timeB = b.fields['Time'] || '00:00';
      return timeA.localeCompare(timeB);
    });

    // Calculate drive time from previous booking
    for (let i = 0; i < dayBookings.length; i++) {
      const currentBooking = dayBookings[i];
      let driveTimeInfo = null;

      if (i > 0) {
        const previousBooking = dayBookings[i - 1];
        
        // Get postcodes
        const fromPostcode = extractPostcode(previousBooking.fields['Property Address'] || previousBooking.fields['Postcode']);
        const toPostcode = extractPostcode(currentBooking.fields['Property Address'] || currentBooking.fields['Postcode']);
        
        if (fromPostcode && toPostcode && fromPostcode !== toPostcode) {
          try {
            const driveTime = await calculateDriveTime(fromPostcode, toPostcode);
            
            driveTimeInfo = {
              fromBooking: previousBooking.fields['Booking Reference'],
              fromAddress: previousBooking.fields['Property Address'],
              fromPostcode: fromPostcode,
              toPostcode: toPostcode,
              driveTimeMinutes: driveTime,
              driveTimeFormatted: formatDriveTime(driveTime),
              previousBookingEndTime: calculateEndTime(previousBooking.fields['Time'], previousBooking.fields['Duration (mins)'] || 60),
              currentBookingStartTime: currentBooking.fields['Time'],
              bufferTime: calculateBufferTime(previousBooking, currentBooking, driveTime),
              hasConflict: checkTimeConflict(previousBooking, currentBooking, driveTime)
            };
          } catch (error) {
            console.error('Error calculating drive time:', error);
          }
        }
      }

      results.push({
        ...currentBooking,
        driveTimeInfo: driveTimeInfo
      });
    }
  }

  return results;
}

// Extract postcode from address string
function extractPostcode(address) {
  if (!address) return null;
  
  // UK postcode regex
  const postcodeRegex = /([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})/i;
  const match = address.match(postcodeRegex);
  
  return match ? match[0].trim().toUpperCase() : null;
}

// Calculate drive time using Google Maps Distance Matrix API
async function calculateDriveTime(fromPostcode, toPostcode) {
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(fromPostcode)}&destinations=${encodeURIComponent(toPostcode)}&mode=driving&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status === 'OK' && data.rows[0]?.elements[0]?.status === 'OK') {
    const durationSeconds = data.rows[0].elements[0].duration.value;
    return Math.ceil(durationSeconds / 60); // Convert to minutes
  }
  
  throw new Error('Unable to calculate drive time');
}

// Format drive time for display
function formatDriveTime(minutes) {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

// Calculate end time of a booking
function calculateEndTime(startTime, durationMinutes) {
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + durationMinutes + 45; // Add 45min buffer after
  
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
}

// Calculate buffer time between bookings
function calculateBufferTime(previousBooking, currentBooking, driveTimeMinutes) {
  const prevEndTime = calculateEndTime(
    previousBooking.fields['Time'], 
    previousBooking.fields['Duration (mins)'] || 60
  );
  
  const [prevHours, prevMins] = prevEndTime.split(':').map(Number);
  const [currHours, currMins] = currentBooking.fields['Time'].split(':').map(Number);
  
  const prevEndTotalMins = prevHours * 60 + prevMins;
  const currStartTotalMins = currHours * 60 + currMins;
  
  const availableBuffer = currStartTotalMins - prevEndTotalMins;
  const requiredBuffer = driveTimeMinutes;
  
  return {
    available: availableBuffer,
    required: requiredBuffer,
    surplus: availableBuffer - requiredBuffer,
    sufficient: availableBuffer >= requiredBuffer
  };
}

// Check if there's a time conflict
function checkTimeConflict(previousBooking, currentBooking, driveTimeMinutes) {
  const buffer = calculateBufferTime(previousBooking, currentBooking, driveTimeMinutes);
  
  // Need: drive time + 45 min setup buffer
  const minimumRequired = driveTimeMinutes + 45;
  
  return buffer.available < minimumRequired;
}