// netlify/functions/create-booking.js
// UPDATED: Now links bookings to authenticated users + sets paymentStatus correctly

exports.handler = async (event, context) => {
  console.log('=== Create Booking Function (Updated with Auth) ===');
  console.log('Method:', event.httpMethod);
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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
    const bookingData = JSON.parse(event.body);
    
    // ✅ NEW: Verify user exists and get their record ID
    const userEmail = bookingData.clientEmail;
    
    if (!userEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'User email required' })
      };
    }

    // ✅ NEW: Fetch user from Airtable
    const filterFormula = `LOWER({Email}) = "${userEmail.toLowerCase()}"`;
    const userUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}?filterByFormula=${encodeURIComponent(filterFormula)}`;

    const userResponse = await fetch(userUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
      }
    });

    const userResult = await userResponse.json();

    if (!userResult.records || userResult.records.length === 0) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'User not found. Please log in first.' })
      };
    }

    const user = userResult.records[0];
    const userId = user.id;

    console.log(`✓ Found user: ${userEmail} (ID: ${userId})`);

    // ✅ NEW: Update user's last booking date and region
    const updateUserUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}/${userId}`;
    
    await fetch(updateUserUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          'Last Booking Date': new Date().toISOString().split('T')[0],
          'Region': bookingData.region ? bookingData.region.charAt(0).toUpperCase() + bookingData.region.slice(1).toLowerCase() : ''
        }
      })
    });

    // ✅ Capitalize region to match Airtable Single Select options (North/South)
    if (bookingData.region) {
      bookingData.region = bookingData.region.charAt(0).toUpperCase() + bookingData.region.slice(1).toLowerCase();
    }
    
    console.log('Received booking data:', {
      postcode: bookingData.postcode,
      region: bookingData.region,
      date: bookingData.date,
      time: bookingData.time,
      service: bookingData.service,
      paymentOption: bookingData.paymentOption
    });

    // Generate booking reference
    const timestamp = Date.now();
    const bookingRef = `BK-${timestamp}`;

    // ✅ FIXED: Set payment status based on payment option OR admin override
let paymentStatus;
let bookingStatus;

// ✅ NEW: Check if this is an admin booking FIRST
if (bookingData.createdBy === 'Admin') {
  // ADMIN BOOKING - Use direct status control
  console.log('Admin booking detected');
  paymentStatus = bookingData.paymentStatus || 'Pending';
  
  if (paymentStatus === 'Paid') {
    bookingStatus = 'Confirmed';
  } else {
    bookingStatus = 'Reserved';
  }
  
  console.log(`Admin booking: Payment=${paymentStatus}, Booking=${bookingStatus}`);
  
// ✅ EXISTING: Customer bookings work EXACTLY as before
} else if (bookingData.paymentOption === 'pay-now') {
  // This shouldn't happen in create-booking (should go through Stripe webhook)
  // But if it does, mark as Paid
  paymentStatus = 'Paid';
  bookingStatus = 'Confirmed';
} else if (bookingData.paymentOption === 'reserve') {
  // Card on file, payment pending
  paymentStatus = 'Pending';
  bookingStatus = 'Reserved';
} else {
  // Fallback
  paymentStatus = 'Pending';
  bookingStatus = 'Booked';
}

console.log(`Final status - Payment: ${paymentStatus}, Booking: ${bookingStatus}`);

    // Prepare add-ons data
    const addonsText = bookingData.addons && bookingData.addons.length > 0
      ? bookingData.addons.map(a => `${a.name} (+£${a.price.toFixed(2)})`).join('\n')
      : '';

    const addonsPrice = bookingData.addonsPrice || 0;

    // Prepare Airtable record
    const airtableRecord = {
  fields: {
    'Booking Reference': bookingRef,
    'User': [userId],
    'Date': bookingData.date,
    'Time': bookingData.time,
    'Postcode': bookingData.postcode,
    'Property Address': bookingData.propertyAddress,
    'Region': bookingData.region,
    'Media Specialist': bookingData.mediaSpecialist,
    'Service': bookingData.service,
    'Service ID': bookingData.serviceId,
    'Duration (mins)': bookingData.duration,
    'Bedrooms': bookingData.bedrooms || 0,
    'Base Price': bookingData.basePrice,
    'Extra Bedroom Fee': bookingData.extraBedroomFee || 0,
    'Add-Ons': addonsText,
    'Add-Ons Price': addonsPrice,
    'Total Price': bookingData.totalPrice,
    'Client Name': bookingData.clientName,
    'Client Email': bookingData.clientEmail,
    'Client Phone': bookingData.clientPhone || '', // ✅ ADD DEFAULT
    'Client Notes': bookingData.clientNotes || '',
    'Access Instructions': bookingData.accessInstructions || '', // ✅ ADD THIS for admin bookings
    
    // ✅ CRITICAL: Set both Booking Status AND Payment Status
    'Booking Status': bookingStatus,
    'Payment Status': paymentStatus,
    
    // ✅ Store Stripe Payment Method details (for reserved bookings)
    'Stripe Payment Method ID': bookingData.stripePaymentMethodId || '',
    'Cardholder Name': bookingData.cardholderName || '',
    'Card Last 4': bookingData.cardLast4 || '',
    'Card Brand': bookingData.cardBrand || '',
    'Card Expiry': bookingData.cardExpiry || '',
    
    // ✅ ADD: Track if created by admin
    'Created By': bookingData.createdBy || 'Customer',
    
    // Metadata
    'Created Date': new Date().toISOString(),
  }
};

    console.log('Creating Airtable record with payment status:', paymentStatus);
    console.log('Airtable record Region field:', airtableRecord.fields.Region);

    // Create booking in Airtable
    const airtableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Bookings`;
    
    const response = await fetch(airtableUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(airtableRecord)
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Airtable error:', errorData);
      throw new Error(`Airtable API error: ${response.status}`);
    }

    const airtableResult = await response.json();
    console.log('Booking created successfully:', bookingRef);

    // ✅ NEW: Send confirmation email via Resend
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        const dateObj = new Date(bookingData.date + 'T12:00:00');
        const formattedDate = dateObj.toLocaleDateString('en-GB', { 
          weekday: 'long', 
          day: 'numeric', 
          month: 'long', 
          year: 'numeric' 
        });

        await resend.emails.send({
          from: 'Markeb Media <commercial@markebmedia.com>',
          to: bookingData.clientEmail,
          bcc: 'commercial@markebmedia.com',
          subject: `Booking Confirmed - ${bookingRef}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #3b82f6;">Booking Confirmation</h2>
              
              <p>Hi ${bookingData.clientName},</p>
              
              <p>Your booking has been confirmed! Here are your details:</p>
              
              <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p><strong>Booking Reference:</strong> ${bookingRef}</p>
                <p><strong>Service:</strong> ${bookingData.service}</p>
                <p><strong>Date:</strong> ${formattedDate}</p>
                <p><strong>Time:</strong> ${bookingData.time}</p>
                <p><strong>Address:</strong> ${bookingData.propertyAddress}</p>
                <p><strong>Media Specialist:</strong> ${bookingData.mediaSpecialist}</p>
                <p><strong>Total:</strong> £${bookingData.totalPrice.toFixed(2)}</p>
              </div>
              
              ${bookingData.paymentOption === 'reserve' && bookingData.cardLast4 ? `
                <div style="background: #eff6ff; border: 2px solid #3b82f6; border-radius: 8px; padding: 16px; margin: 20px 0;">
                  <p style="margin: 0;"><strong>Payment:</strong> Your card ending in ${bookingData.cardLast4} will be charged after we complete your shoot.</p>
                </div>
              ` : ''}
              
              <p>View your booking in your <a href="https://markebmedia.com/uc-dash.html" style="color: #3b82f6;">dashboard</a>.</p>
              
              <p style="color: #64748b;">
                Best regards,<br>
                The Markeb Media Team
              </p>
            </div>
          `
        });

        console.log(`✓ Confirmation email sent to ${bookingData.clientEmail}`);
      } catch (emailError) {
        console.error('Error sending confirmation email:', emailError);
        // Don't fail the booking if email fails
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        bookingRef: bookingRef,
        recordId: airtableResult.id,
        paymentStatus: paymentStatus,
        message: paymentStatus === 'Paid' 
          ? 'Booking confirmed and paid' 
          : 'Booking reserved - payment pending'
      })
    };

  } catch (error) {
    console.error('Error creating booking:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to create booking',
        details: error.message
      })
    };
  }
};