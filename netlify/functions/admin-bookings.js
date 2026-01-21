// netlify/functions/admin-bookings.js
// Fetches bookings for admin panel with drive time calculations

const Airtable = require('airtable');

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

    console.log('Filters:', { startDate, endDate, region, status, paymentStatus });

    // Initialize Airtable
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    // Build filter formula - MATCH FIELD NAMES FROM CREATE-BOOKING.JS
    let filters = [];
    
    if (startDate && endDate) {
      filters.push(`AND(IS_AFTER({Date}, DATEADD('${startDate}', -1, 'days')), IS_BEFORE({Date}, DATEADD('${endDate}', 1, 'days')))`);
    }
    
    if (region) {
      filters.push(`{Region} = '${region}'`);
    }
    
    if (status) {
      filters.push(`{Booking Status} = '${status}'`);
    }
    
    // Handle payment status filter
    if (paymentStatus) {
      if (paymentStatus === 'Pending') {
        // Include both explicit "Pending" and empty/blank values
        filters.push(`OR({Payment Status} = 'Pending', {Payment Status} = BLANK())`);
      } else {
        filters.push(`{Payment Status} = '${paymentStatus}'`);
      }
    }

    const filterFormula = filters.length > 0 ? `AND(${filters.join(', ')})` : '';

    console.log('Filter formula:', filterFormula);

    // Fetch bookings from Airtable
    const bookings = await base('Bookings')
      .select({
        filterByFormula: filterFormula || undefined,
        sort: [
          { field: 'Date', direction: 'desc' },
          { field: 'Time', direction: 'asc' }
        ]
      })
      .all();

    console.log(`Found ${bookings.length} bookings`);

    // Calculate statistics
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    const stats = {
      total: bookings.length,
      upcoming: bookings.filter(b => b.fields['Date'] >= today && b.fields['Booking Status'] !== 'Cancelled').length,
      pending: bookings.filter(b => 
        b.fields['Payment Status'] === 'Pending' && 
        b.fields['Booking Status'] !== 'Cancelled'
      ).length
    };

    // Calculate drive times between consecutive bookings
    const bookingsWithDriveTimes = await calculateDriveTimes(bookings);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        bookings: bookingsWithDriveTimes,
        stats: stats
      })
    };

  } catch (error) {
    console.error('Error fetching bookings:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch bookings',
        details: error.message
      })
    };
  }
};

// Calculate drive times between consecutive bookings
async function calculateDriveTimes(bookings) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.log('No Google Maps API key - skipping drive time calculations');
    return bookings.map(b => ({ ...b, driveTimeInfo: null }));
  }

  // Group bookings by date and media specialist
  const grouped = {};
  
  bookings.forEach(booking => {
    const date = booking.fields['Date'];
    const specialist = booking.fields['Media Specialist'];
    const key = `${date}-${specialist}`;
    
    if (!grouped[key]) {
      grouped[key] = [];
    }
    
    grouped[key].push(booking);
  });

  // Sort each group by time
  Object.keys(grouped).forEach(key => {
    grouped[key].sort((a, b) => {
      const timeA = a.fields['Time'];
      const timeB = b.fields['Time'];
      return timeA.localeCompare(timeB);
    });
  });

  // Calculate drive times
  const results = [];
  
  for (const key of Object.keys(grouped)) {
    const dayBookings = grouped[key];
    
    for (let i = 0; i < dayBookings.length; i++) {
      const currentBooking = dayBookings[i];
      let driveTimeInfo = null;
      
      if (i > 0) {
        const previousBooking = dayBookings[i - 1];
        driveTimeInfo = await calculateDriveTimeBetweenBookings(previousBooking, currentBooking);
      }
      
      results.push({
        ...currentBooking,
        driveTimeInfo
      });
    }
  }
  
  return results;
}

// Calculate drive time between two bookings
async function calculateDriveTimeBetweenBookings(previousBooking, currentBooking) {
  try {
    const origin = previousBooking.fields['Postcode'];
    const destination = currentBooking.fields['Postcode'];
    
    if (!origin || !destination) {
      return null;
    }

    // Call Google Maps Distance Matrix API
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&mode=driving&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status !== 'OK' || !data.rows[0]?.elements[0]) {
      return null;
    }
    
    const element = data.rows[0].elements[0];
    
    if (element.status !== 'OK') {
      return null;
    }
    
    const driveTimeMinutes = Math.ceil(element.duration.value / 60);
    const driveTimeFormatted = formatDuration(driveTimeMinutes);
    
    // Calculate time gap between bookings
    const previousEndTime = calculateEndTime(
      previousBooking.fields['Time'],
      previousBooking.fields['Duration (mins)']
    );
    
    const currentStartTime = currentBooking.fields['Time'];
    const gapMinutes = calculateTimeGap(previousEndTime, currentStartTime);
    
    // Calculate buffer time (gap - drive time)
    const bufferMinutes = gapMinutes - driveTimeMinutes;
    
    return {
      fromBooking: previousBooking.fields['Property Address'],
      driveTimeMinutes,
      driveTimeFormatted,
      previousBookingEndTime: previousEndTime,
      currentBookingStartTime: currentStartTime,
      gapMinutes,
      bufferTime: {
        available: gapMinutes,
        required: driveTimeMinutes,
        surplus: bufferMinutes,
        sufficient: bufferMinutes >= 15 // At least 15min buffer is ideal
      },
      hasConflict: bufferMinutes < 0 // Negative buffer = overlap
    };
    
  } catch (error) {
    console.error('Error calculating drive time:', error);
    return null;
  }
}

// Helper: Calculate end time given start time and duration
function calculateEndTime(startTime, durationMinutes) {
  const [hours, minutes] = startTime.split(':').map(Number);
  const startMinutes = hours * 60 + minutes;
  const endMinutes = startMinutes + durationMinutes;
  
  const endHours = Math.floor(endMinutes / 60);
  const endMins = endMinutes % 60;
  
  return `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
}

// Helper: Calculate time gap in minutes
function calculateTimeGap(time1, time2) {
  const [h1, m1] = time1.split(':').map(Number);
  const [h2, m2] = time2.split(':').map(Number);
  
  const minutes1 = h1 * 60 + m1;
  const minutes2 = h2 * 60 + m2;
  
  return minutes2 - minutes1;
}

// Helper: Format duration
function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}