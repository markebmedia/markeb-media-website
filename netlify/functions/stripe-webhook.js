// netlify/functions/stripe-webhook.js
// UPDATED: Now handles cancellation payments and moves bookings to Cancelled Bookings table
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: `Webhook Error: ${err.message}` })
    };
  }

  // Handle the checkout.session.completed event
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    try {
      const metadata = session.metadata;
      
      // ✅ NEW: Check if this is a cancellation payment
      if (metadata.cancellationType) {
        console.log('Processing paid cancellation:', metadata.bookingRef);
        
        const bookingId = metadata.bookingId;
        const bookingRef = metadata.bookingRef;
        const cancellationFee = parseFloat(metadata.cancellationFee);
        
        // Fetch booking to get region
        const booking = await base('Bookings').find(bookingId);
        const region = booking.fields['Region'];
        
        // Update main booking to Cancelled
        await base('Bookings').update(bookingId, {
          'Booking Status': 'Cancelled',
          'Cancellation Date': new Date().toISOString().split('T')[0],
          'Cancellation Reason': metadata.cancellationReason || 'Customer requested',
          'Cancellation Charge %': metadata.cancellationType === '50% Late Cancellation Fee' ? 50 : 100,
          'Cancellation Fee': cancellationFee,
          'Refund Amount': parseFloat(metadata.originalTotalPrice) - cancellationFee,
          'Cancelled By': 'Client',
          'Cancellation Pending': false,
          'Cancellation Payment Status': 'Paid',
          'Stripe Cancellation Session ID': session.id
        });
        
        console.log(`✅ Booking ${bookingRef} cancelled (paid)`);
        
        // Move Active Booking to Cancelled Bookings
        try {
          const activeBookings = await base('tblRgcv7M9dUU3YuL')
            .select({
              filterByFormula: `{Booking ID} = '${bookingRef}'`,
              maxRecords: 1
            })
            .firstPage();

          if (activeBookings && activeBookings.length > 0) {
            const activeBooking = activeBookings[0];
            const activeBookingData = activeBooking.fields;
            
            // Create record in Cancelled Bookings
            await base('Cancelled Bookings').create({
              'Project Address': activeBookingData['Project Address'],
              'Customer Name': activeBookingData['Customer Name'],
              'Service Type': activeBookingData['Service Type'],
              'Shoot Date': activeBookingData['Shoot Date'],
              'Status': 'Cancelled',
              'Email Address': activeBookingData['Email Address'],
              'Phone Number': activeBookingData['Phone Number'],
              'Booking ID': activeBookingData['Booking ID'],
              'Delivery Link': activeBookingData['Delivery Link'],
              'Region': activeBookingData['Region'],
              'Media Specialist': activeBookingData['Media Specialist'],
              'Cancellation Date': new Date().toISOString().split('T')[0],
              'Cancellation Reason': metadata.cancellationReason || 'Customer requested'
            });
            
            console.log(`✓ Booking moved to Cancelled Bookings`);
            
            // Delete from Active Bookings
            await base('tblRgcv7M9dUU3YuL').destroy(activeBooking.id);
            console.log(`✓ Booking removed from Active Bookings`);
          }
        } catch (activeBookingError) {
          console.error('Error moving Active Booking:', activeBookingError);
        }
        
        // Send cancellation confirmation email with region
        await sendCancellationConfirmation(metadata, session, cancellationFee, region);
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ received: true, bookingRef: bookingRef, action: 'cancelled' })
        };
      }
      
      // Check if this is an existing booking update (admin payment link)
      if (metadata.bookingId) {
        console.log('Updating existing booking:', metadata.bookingId);
        
        // UPDATE existing booking from Pending → Paid
        await base('Bookings').update(metadata.bookingId, {
          'Payment Status': 'Paid',
          'Booking Status': 'Confirmed',
          'Stripe Session ID': session.id,
          'Stripe Payment Intent ID': session.payment_intent,
          'Payment Date': new Date().toISOString(),
          'Amount Paid': session.amount_total / 100
        });
        
        console.log('✅ Booking updated to Paid');
        
        // Send payment confirmation email
        await sendPaymentConfirmation(metadata, session);
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ received: true, bookingId: metadata.bookingId, action: 'updated' })
        };
      }

      // CREATE new booking (Pay Now flow)
      const bookingRef = `BK-${Date.now()}`;
      
      console.log('Creating new booking from webhook:', {
        bookingRef,
        region: metadata.region,
        service: metadata.service
      });

      // ✅ Fetch user from Airtable to link booking
      let userId = null;
      try {
        const userEmail = metadata.clientEmail;
        const filterFormula = `LOWER({Email}) = "${userEmail.toLowerCase()}"`;
        const userUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}?filterByFormula=${encodeURIComponent(filterFormula)}`;

        const userResponse = await fetch(userUrl, {
          headers: {
            'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
          }
        });

        const userResult = await userResponse.json();

        if (userResult.records && userResult.records.length > 0) {
          userId = userResult.records[0].id;
          console.log(`✓ Found user: ${userEmail} (ID: ${userId})`);
          
          // Update user's last booking date
          await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}/${userId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              fields: {
                'Last Booking Date': new Date().toISOString().split('T')[0],
                'Region': metadata.region ? metadata.region.charAt(0).toUpperCase() + metadata.region.slice(1).toLowerCase() : ''
              }
            })
          });
        } else {
          console.warn(`⚠️ User not found for email: ${userEmail}`);
        }
      } catch (userError) {
        console.error('Error fetching user:', userError);
      }

      // Parse add-ons
      const addons = JSON.parse(metadata.addons || '[]');
      const addonsText = addons.length > 0
        ? addons.map(a => `${a.name} (+£${parseFloat(a.price).toFixed(2)})`).join('\n')
        : '';
      
      const addonsPrice = addons.reduce((sum, a) => sum + parseFloat(a.price || 0), 0);

      // Extract discount information
      const discountCode = metadata.discountCode || '';
      const discountAmount = parseFloat(metadata.discountAmount || '0');
      const priceBeforeDiscount = parseFloat(metadata.priceBeforeDiscount || '0');

      // Calculate prices
      const totalPrice = session.amount_total / 100;
      const bedrooms = parseInt(metadata.bedrooms) || 0;
      const extraBedrooms = Math.max(0, bedrooms - 4);
      const extraBedroomFee = extraBedrooms * 30;
      
      let basePrice;
      if (discountAmount > 0 && priceBeforeDiscount > 0) {
        basePrice = priceBeforeDiscount - extraBedroomFee - addonsPrice;
      } else {
        basePrice = totalPrice - extraBedroomFee - addonsPrice;
      }

      const capitalizedRegion = metadata.region 
        ? metadata.region.charAt(0).toUpperCase() + metadata.region.slice(1).toLowerCase()
        : 'Unknown';

      // CREATE booking
      const bookingRecord = await base('Bookings').create([
        {
          fields: {
            'Booking Reference': bookingRef,
            'User': userId ? [userId] : [],
            'Date': metadata.date,
            'Time': metadata.time,
            'Postcode': metadata.postcode,
            'Property Address': metadata.propertyAddress,
            'Region': capitalizedRegion,
            'Media Specialist': metadata.mediaSpecialist,
            'Service': metadata.service,
            'Service ID': metadata.serviceId,
            'Duration (mins)': parseInt(metadata.duration) || 90,
            'Bedrooms': bedrooms,
            'Base Price': basePrice,
            'Extra Bedroom Fee': extraBedroomFee,
            'Add-Ons': addonsText,
            'Add-Ons Price': addonsPrice,
            
            'Discount Code': discountCode,
            'Discount Amount': discountAmount,
            'Price Before Discount': priceBeforeDiscount > 0 ? priceBeforeDiscount : totalPrice,
            'Final Price': totalPrice,
            
            'Client Name': metadata.clientName,
            'Client Email': metadata.clientEmail,
            'Client Phone': metadata.clientPhone || '',
            'Client Notes': metadata.clientNotes || '',
            'Access Instructions': metadata.accessInstructions || '',
            
            'Booking Status': 'Confirmed',
            'Payment Status': 'Paid',
            'Payment Method': 'Stripe',
            'Stripe Session ID': session.id,
            'Stripe Payment Intent ID': session.payment_intent,
            'Payment Date': new Date().toISOString(),
            'Amount Paid': totalPrice,
            
            'Created By': 'Customer',
            'Created Date': new Date().toISOString(),
            'Cancellation Allowed Until': new Date(new Date(metadata.date).getTime() - 24 * 60 * 60 * 1000).toISOString()
          }
        }
      ]);

      console.log('✅ Booking created from webhook:', bookingRecord[0].id);

      // Send payment confirmation email with region
      await sendPaymentConfirmation(metadata, session, bookingRef, discountCode, discountAmount, capitalizedRegion);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ received: true, bookingId: bookingRecord[0].id, action: 'created' })
      };

    } catch (error) {
      console.error('❌ Error processing webhook:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to process payment' })
      };
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ received: true })
  };
};

// Send payment confirmation email
async function sendPaymentConfirmation(metadata, session, bookingRef, discountCode = '', discountAmount = 0, region = '') {
  if (!process.env.RESEND_API_KEY) {
    console.log('Resend not configured - skipping email');
    return;
  }

  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const ref = bookingRef || metadata.bookingRef || 'N/A';
    const amountPaid = session.amount_total / 100;
    
    const discountHTML = discountCode && discountAmount > 0 ? `
      <div style="background: #d1fae5; border: 2px solid #10b981; border-radius: 8px; padding: 15px; margin: 15px 0;">
        <div style="font-size: 14px; color: #065f46; font-weight: 600;">💰 DISCOUNT APPLIED</div>
        <p style="margin: 8px 0 0 0; color: #065f46;"><strong>${discountCode}</strong> - Saved £${discountAmount.toFixed(2)}</p>
      </div>
    ` : '';

    // ✅ Determine BCC recipients based on region
    const bccRecipients = ['commercial@markebmedia.com'];
    
    if (region) {
      if (region.toLowerCase() === 'north') {
        bccRecipients.push('Jodie.Hamshaw@markebmedia.com');
        console.log('✓ BCC: Adding Jodie (North region)');
      } else if (region.toLowerCase() === 'south') {
        bccRecipients.push('Maeve.Darley@markebmedia.com');
        console.log('✓ BCC: Adding Maeve (South region)');
      }
    }

    await resend.emails.send({
      from: 'Markeb Media <commercial@markebmedia.com>',
      to: metadata.clientEmail,
      bcc: bccRecipients, // ✅ Array of BCC recipients
      subject: `Payment Confirmed - ${ref}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;">
            <div style="font-size: 48px; margin-bottom: 10px;">✅</div>
            <h1 style="margin: 0; font-size: 32px; font-weight: 700;">Payment Confirmed!</h1>
          </div>
          
          <div style="padding: 40px 30px; background: #ffffff;">
            <p style="font-size: 16px; color: #333;">Hi <strong>${metadata.clientName}</strong>,</p>
            <p style="font-size: 16px; color: #333;">Your payment has been successfully processed and your booking is confirmed!</p>
            
            ${discountHTML}
            
            <div style="background: #d1fae5; border: 2px solid #10b981; border-radius: 12px; padding: 20px; margin: 25px 0; text-align: center;">
              <div style="font-size: 14px; color: #065f46; font-weight: 600;">PAYMENT RECEIVED</div>
              <div style="font-size: 36px; font-weight: 700; color: #065f46; margin-top: 8px;">£${amountPaid.toFixed(2)}</div>
            </div>
            
            <div style="background: #f8fafc; border-left: 4px solid #10b981; padding: 25px; margin: 25px 0;">
              <h3 style="margin: 0 0 15px 0; font-size: 18px;">Booking Details</h3>
              <p><strong>Reference:</strong> ${ref}</p>
              <p><strong>Service:</strong> ${metadata.service}</p>
              <p><strong>Date:</strong> ${metadata.date} at ${metadata.time}</p>
              <p><strong>Property:</strong> ${metadata.propertyAddress}</p>
              <p><strong>Media Specialist:</strong> ${metadata.mediaSpecialist}</p>
            </div>
            
            <p style="font-size: 16px; color: #333;">Thank you for choosing Markeb Media!</p>
          </div>
        </div>
      `
    });

    console.log('✅ Payment confirmation email sent');
  } catch (emailError) {
    console.error('⚠️ Failed to send payment confirmation:', emailError);
  }
}

// ✅ Send cancellation confirmation email
async function sendCancellationConfirmation(metadata, session, cancellationFee, region = '') {
  if (!process.env.RESEND_API_KEY) {
    console.log('Resend not configured - skipping email');
    return;
  }

  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const refundAmount = parseFloat(metadata.originalTotalPrice) - cancellationFee;

    // ✅ Determine BCC recipients based on region
    const bccRecipients = ['commercial@markebmedia.com'];
    
    if (region) {
      if (region.toLowerCase() === 'north') {
        bccRecipients.push('Jodie.Hamshaw@markebmedia.com');
        console.log('✓ BCC: Adding Jodie (North region)');
      } else if (region.toLowerCase() === 'south') {
        bccRecipients.push('Maeve.Darley@markebmedia.com');
        console.log('✓ BCC: Adding Maeve (South region)');
      }
    }

    await resend.emails.send({
      from: 'Markeb Media <commercial@markebmedia.com>',
      to: metadata.clientEmail,
      bcc: bccRecipients, // ✅ Array of BCC recipients
      subject: `Booking Cancelled - ${metadata.bookingRef}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ef4444;">Booking Cancelled</h2>
          <p>Your booking has been successfully cancelled.</p>
          <p><strong>Cancellation Fee:</strong> £${cancellationFee.toFixed(2)}</p>
          <p><strong>Refund Amount:</strong> £${refundAmount.toFixed(2)}</p>
          <p>The refund will be processed to your original payment method within 5-7 business days.</p>
        </div>
      `
    });

    console.log('✅ Cancellation confirmation email sent');
  } catch (emailError) {
    console.error('⚠️ Failed to send cancellation email:', emailError);
  }
}