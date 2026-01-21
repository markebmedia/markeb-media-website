// netlify/functions/get-user-bookings.js
// Get all bookings for a specific user by their email

exports.handler = async (event, context) => {
  console.log('=== Get User Bookings Function ===');
  console.log('Method:', event.httpMethod);
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  try {
    const { email } = JSON.parse(event.body);

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Email required' })
      };
    }

    console.log(`Fetching bookings for: ${email}`);

    // Fetch all bookings for this user email
    const filterFormula = `LOWER({Client Email}) = "${email.toLowerCase()}"`;
    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Bookings?filterByFormula=${encodeURIComponent(filterFormula)}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Airtable API error:', response.status, errorText);
      throw new Error(`Airtable API error: ${response.status}`);
    }

    const result = await response.json();
    const bookings = result.records || [];

    console.log(`✓ Retrieved ${bookings.length} bookings for ${email}`);

    // Calculate some stats
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    const stats = {
      total: bookings.length,
      upcoming: bookings.filter(b => 
        b.fields['Date'] >= today && 
        b.fields['Booking Status'] !== 'Cancelled'
      ).length,
      completed: bookings.filter(b => 
        b.fields['Booking Status'] === 'Completed'
      ).length,
      cancelled: bookings.filter(b => 
        b.fields['Booking Status'] === 'Cancelled'
      ).length,
      pending: bookings.filter(b => 
        b.fields['Payment Status'] === 'Pending' && 
        b.fields['Booking Status'] !== 'Cancelled'
      ).length
    };

    // Format bookings for easier frontend consumption
    const formattedBookings = bookings.map(booking => ({
      id: booking.id,
      bookingRef: booking.fields['Booking Reference'],
      date: booking.fields['Date'],
      time: booking.fields['Time'],
      service: booking.fields['Service'],
      serviceId: booking.fields['Service ID'],
      propertyAddress: booking.fields['Property Address'],
      postcode: booking.fields['Postcode'],
      region: booking.fields['Region'],
      mediaSpecialist: booking.fields['Media Specialist'],
      duration: booking.fields['Duration (mins)'],
      bedrooms: booking.fields['Bedrooms'],
      basePrice: booking.fields['Base Price'],
      extraBedroomFee: booking.fields['Extra Bedroom Fee'],
      addons: booking.fields['Add-ons'],
      addonsPrice: booking.fields['Add-ons Price'],
      totalPrice: booking.fields['Total Price'],
      bookingStatus: booking.fields['Booking Status'],
      paymentStatus: booking.fields['Payment Status'],
      notes: booking.fields['Client Notes'],
      createdDate: booking.fields['Created Date'],
      
      // Card details (for reserved bookings)
      stripePaymentMethodId: booking.fields['Stripe Payment Method ID'],
      cardLast4: booking.fields['Card Last 4'],
      cardBrand: booking.fields['Card Brand'],
      cardExpiry: booking.fields['Card Expiry'],
      
      // Cancellation info
      cancellationDate: booking.fields['Cancellation Date'],
      cancellationReason: booking.fields['Cancellation Reason'],
      cancellationCharge: booking.fields['Cancellation Charge'],
      refundAmount: booking.fields['Refund Amount'],
      
      // Reschedule info
      rescheduled: booking.fields['Rescheduled'],
      originalDate: booking.fields['Original Date'],
      originalTime: booking.fields['Original Time']
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        bookings: formattedBookings,
        stats: stats,
        total: bookings.length
      })
    };

  } catch (error) {
    console.error('Error fetching user bookings:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        message: 'Failed to fetch bookings',
        error: error.message 
      })
    };
  }
};