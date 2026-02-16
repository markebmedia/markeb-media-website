// netlify/functions/create-booking.js
// UPDATED: Now links bookings to authenticated users + sets paymentStatus correctly + handles free bookings + creates Active Bookings with Dropbox folders + SUPPORTS GUEST BOOKINGS + ACCESS TYPE

exports.handler = async (event, context) => {
  console.log('=== Create Booking Function (Updated with Auth + Active Bookings + Guest Support + Access Type) ===');
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
    
    // ✅ Verify user email exists
    const userEmail = bookingData.clientEmail;
    
    if (!userEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'User email required' })
      };
    }

    // ✅ NEW: Fetch user from Airtable (but allow guest bookings if not found)
    const filterFormula = `LOWER({Email}) = "${userEmail.toLowerCase()}"`;
    const userUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}?filterByFormula=${encodeURIComponent(filterFormula)}`;

    const userResponse = await fetch(userUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
      }
    });

    const userResult = await userResponse.json();

    // ✅ NEW: Try to find existing user, but proceed as guest if not found
    let userId = null;

    if (userResult.records && userResult.records.length > 0) {
      const user = userResult.records[0];
      userId = user.id;
      console.log(`✓ Found existing user: ${userEmail} (ID: ${userId})`);
      
      // ✅ Update user's last booking date and region
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
      
    } else {
      console.log(`⚠️ User not found for email: ${userEmail} - proceeding as GUEST booking (no user link)`);
      // userId remains null - this is a guest booking
    }

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
      paymentOption: bookingData.paymentOption,
      totalPrice: bookingData.totalPrice,
      accessType: bookingData.accessType,
      userType: userId ? 'Registered' : 'Guest'
    });

    // Generate booking reference
    const timestamp = Date.now();
    const bookingRef = `BK-${timestamp}`;

    // ✅ UPDATED: Set payment status based on payment option, admin override, or free booking
    let paymentStatus;
    let bookingStatus;

    // ✅ Check if this is an admin booking FIRST
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
      
    // ✅ Handle trusted customers who can book without payment
    } else if (bookingData.paymentOption === 'book-without-payment') {
      paymentStatus = 'Pending';
      bookingStatus = 'Confirmed'; // Booking is confirmed, payment comes later
      console.log('Trusted customer - booking without payment (invoice later)');
      
    // ✅ Handle free/100% discount bookings
    } else if (bookingData.paymentOption === 'free' || bookingData.totalPrice === 0) {
      paymentStatus = 'Paid'; // Mark as paid (£0 = nothing to pay)
      bookingStatus = 'Confirmed';
      console.log('Free booking (100% discount or £0 total) - marking as Paid/Confirmed');
      
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

    // ✅ Handle discount code
    let discountCodeId = null;
    let discountAmount = 0;
    let priceBeforeDiscount = 0;
    let finalPrice = bookingData.totalPrice;

    if (bookingData.discountCode && bookingData.discountAmount > 0) {
      console.log('Discount code applied:', bookingData.discountCode);
      
      discountAmount = bookingData.discountAmount || 0;
      priceBeforeDiscount = bookingData.priceBeforeDiscount || (bookingData.totalPrice + discountAmount);
      finalPrice = priceBeforeDiscount - discountAmount;
      
      console.log('Discount details:', {
        code: bookingData.discountCode,
        discountAmount,
        priceBeforeDiscount,
        finalPrice
      });
      
      // Increment usage count for discount code
      try {
        const discountFilterFormula = `UPPER({Code}) = "${bookingData.discountCode.toUpperCase()}"`;
        
        const discountUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_DISCOUNT_CODES_TABL}?filterByFormula=${encodeURIComponent(discountFilterFormula)}`;
        
        const discountResponse = await fetch(discountUrl, {
          headers: {
            'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
          }
        });
        
        const discountData = await discountResponse.json();
        
        if (discountData.records && discountData.records.length > 0) {
          const discountRecord = discountData.records[0];
          discountCodeId = discountRecord.id;
          const currentUsage = discountRecord.fields['Times Used'] || 0;
          
          // Update usage count
          const updateDiscountUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_DISCOUNT_CODES_TABL}/${discountCodeId}`;
          
          await fetch(updateDiscountUrl, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              fields: {
                'Times Used': currentUsage + 1
              }
            })
          });
          
          console.log(`✓ Discount code usage updated: ${bookingData.discountCode} (${currentUsage} → ${currentUsage + 1})`);
        } else {
          console.warn('⚠️ Discount code record not found in Airtable:', bookingData.discountCode);
        }
      } catch (discountError) {
        console.error('Error updating discount code usage:', discountError);
        // Don't fail the booking if discount update fails
      }
    } else {
      console.log('No discount code applied');
      priceBeforeDiscount = finalPrice;
    }

    // Prepare Airtable record
    const airtableRecord = {
      fields: {
        'Booking Reference': bookingRef,
        
        // ✅ UPDATED: Only link to User if userId exists (registered customer)
        ...(userId && { 'User': [userId] }),
        
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
        
        // ✅ Discount fields
        'Discount Code': discountAmount > 0 ? bookingData.discountCode : '',
        'Discount Amount': discountAmount,
        'Price Before Discount': priceBeforeDiscount,
        'Final Price': finalPrice,
        
        'Client Name': bookingData.clientName,
        'Client Email': bookingData.clientEmail,
        'Client Phone': bookingData.clientPhone || '',
        'Client Notes': bookingData.clientNotes || '',
        
        // ✅ NEW: Access Type fields
        'Access Type': bookingData.accessType || '',
        'Key Pickup Location': bookingData.keyPickupLocation || '',
        
        'Booking Status': bookingStatus,
        'Payment Status': paymentStatus,
        
        'Stripe Payment Method ID': bookingData.stripePaymentMethodId || '',
        'Cardholder Name': bookingData.cardholderName || '',
        'Card Last 4': bookingData.cardLast4 || '',
        'Card Brand': bookingData.cardBrand || '',
        'Card Expiry': bookingData.cardExpiry || '',
        
        'Created By': bookingData.createdBy || 'Customer',
        'Created Date': new Date().toISOString(),
      }
    };

    console.log('Creating Airtable record with payment status:', paymentStatus);
    console.log('Airtable record Region field:', airtableRecord.fields.Region);
    console.log('Airtable record Access Type:', airtableRecord.fields['Access Type']);
    console.log('User linked:', userId ? 'Yes' : 'No (Guest)');

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

    // ✅ NEW: Create Active Booking record + Dropbox folders (QC Delivery + Raw Client)
    let trackingCode = '';
    
    try {
      const { createActiveBooking } = require('./create-active-booking');
      
      const activeBookingData = {
  bookingRef: bookingRef,
  propertyAddress: bookingData.propertyAddress,
  postcode: bookingData.postcode,
  clientName: bookingData.clientName,
  clientEmail: bookingData.clientEmail,
  clientPhone: bookingData.clientPhone,
  service: bookingData.service,
  date: bookingData.date,
  time: bookingData.time,
  region: bookingData.region,
  mediaSpecialist: bookingData.mediaSpecialist,
  bookingStatus: bookingStatus,
  paymentStatus: paymentStatus,
  addons: bookingData.addons || []  // ✅ ADD THIS LINE
};

      const activeBookingResult = await createActiveBooking(activeBookingData);
      
      if (activeBookingResult.success) {
        trackingCode = activeBookingResult.trackingCode || '';
        console.log(`✓ Active Booking created with ID: ${activeBookingResult.activeBookingId}`);
        console.log(`✓ Tracking Code: ${trackingCode}`);
        console.log(`✓ QC Delivery folder created with link: ${activeBookingResult.dropboxLink}`);
        console.log(`✓ Raw Client folders created for company`);
      } else {
        console.error('⚠️ Active Booking creation failed:', activeBookingResult.error);
        // Don't fail the main booking if Active Booking creation fails
      }

    } catch (activeBookingError) {
      console.error('Error creating Active Booking:', activeBookingError);
      // Don't fail the booking if Active Booking creation fails
    }

    // ✅ Send confirmation email via Resend (MOVED HERE - after Active Booking creation)
    if (process.env.RESEND_API_KEY) {
      try {
        const { sendBookingConfirmation } = require('./email-service');
        
        const emailData = {
  bookingRef: bookingRef,
  clientName: bookingData.clientName,
  clientEmail: bookingData.clientEmail,
  service: bookingData.service,
  date: bookingData.date,
  time: bookingData.time,
  propertyAddress: bookingData.propertyAddress,
  postcode: bookingData.postcode,
  mediaSpecialist: bookingData.mediaSpecialist,
  totalPrice: finalPrice,
  duration: bookingData.duration,
  paymentStatus: paymentStatus,
  bookingStatus: bookingStatus,
  createdBy: bookingData.createdBy || 'Customer',
  cardLast4: bookingData.cardLast4 || '',
  discountCode: bookingData.discountCode || '',
  discountAmount: discountAmount,
  trackingCode: trackingCode,
  region: bookingData.region,
  accessType: bookingData.accessType || '',
  keyPickupLocation: bookingData.keyPickupLocation || '',
  addons: bookingData.addons || []  // ✅ ADD THIS LINE
};

        await sendBookingConfirmation(emailData);
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
        userType: userId ? 'registered' : 'guest',
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