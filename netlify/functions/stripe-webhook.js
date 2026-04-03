// netlify/functions/stripe-webhook.js
// UPDATED: Handles cancellation payments, moves bookings to Cancelled Bookings,
// supports guest bookings, access type fields
// SECURITY FIX: isBase64Encoded handling to prevent body parsing corruption on Netlify

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

  // ✅ FIX: Netlify sometimes base64-encodes the raw body
  // Stripe signature verification requires the exact raw bytes —
  // if the body has been transformed at all, constructEvent throws
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    console.error('Signature header present:', !!sig);
    console.error('Body length:', rawBody?.length);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: `Webhook Error: ${err.message}` })
    };
  }

  console.log('✅ Webhook verified. Event type:', stripeEvent.type);

  // Handle the checkout.session.completed event
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    try {
      const metadata = session.metadata;
      
      // ✅ Check if this is a cancellation payment
      if (metadata.cancellationType) {
        console.log('Processing paid cancellation:', metadata.bookingRef);
        
        const bookingId = metadata.bookingId;
        const bookingRef = metadata.bookingRef;
        const cancellationFee = parseFloat(metadata.cancellationFee);
        
        const booking = await base('Bookings').find(bookingId);
        const region = booking.fields['Region'];
        
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
            
            await base('tblRgcv7M9dUU3YuL').destroy(activeBooking.id);
            console.log(`✓ Booking removed from Active Bookings`);
          }
        } catch (activeBookingError) {
          console.error('Error moving Active Booking:', activeBookingError);
        }
        
        await sendCancellationConfirmation(metadata, session, cancellationFee, region);
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ received: true, bookingRef: bookingRef, action: 'cancelled' })
        };
      }
      
      // ✅ Check if this is an existing booking update (admin payment link)
      if (metadata.bookingId) {
        console.log('Updating existing booking:', metadata.bookingId);
        
        await base('Bookings').update(metadata.bookingId, {
          'Payment Status': 'Paid',
          'Booking Status': 'Confirmed',
          'Stripe Session ID': session.id,
          'Stripe Payment Intent ID': session.payment_intent,
          'Payment Date': new Date().toISOString(),
          'Amount Paid': session.amount_total / 100
        });
        
        console.log('✅ Booking updated to Paid');
        
        if (process.env.RESEND_API_KEY) {
          try {
            const { sendPaymentConfirmation } = require('./email-service');
            
            const emailData = {
              bookingRef: metadata.bookingRef,
              clientName: metadata.clientName,
              clientEmail: metadata.clientEmail,
              service: metadata.service,
              date: metadata.date,
              time: metadata.time,
              propertyAddress: metadata.propertyAddress,
              postcode: metadata.postcode,
              mediaSpecialist: metadata.mediaSpecialist,
              amountPaid: session.amount_total / 100,
              duration: parseInt(metadata.duration) || 90
            };
            
            await sendPaymentConfirmation(emailData);
            console.log(`✓ Payment confirmation email sent to ${metadata.clientEmail}`);
            
          } catch (emailError) {
            console.error('Error sending payment confirmation email:', emailError);
          }
        }
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ received: true, bookingId: metadata.bookingId, action: 'updated' })
        };
      }

      // ✅ CREATE new booking (Pay Now flow)
      const bookingRef = `BK-${Date.now()}`;
      
      console.log('Creating new booking from webhook:', {
        bookingRef,
        region: metadata.region,
        service: metadata.service,
        clientEmail: metadata.clientEmail
      });

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
          console.log(`✓ Found existing user: ${userEmail} (ID: ${userId})`);
          
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
          console.log(`⚠️ User not found for email: ${userEmail} - proceeding as GUEST booking`);
        }
        
      } catch (userError) {
        console.error('Error fetching user:', userError);
      }

      const addons = JSON.parse(metadata.addons || '[]');
      const addonsText = addons.length > 0
        ? addons.map(a => `${a.name} (+£${parseFloat(a.price).toFixed(2)})`).join('\n')
        : '';
      
      const addonsPrice = addons.reduce((sum, a) => sum + parseFloat(a.price || 0), 0);

      const discountCode = metadata.discountCode || '';
      const discountAmount = parseFloat(metadata.discountAmount || '0');
      const priceBeforeDiscount = parseFloat(metadata.priceBeforeDiscount || '0');

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

      const bookingFields = {
        'Booking Reference': bookingRef,
        
        ...(userId && { 'User': [userId] }),
        
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

        'Access Type': metadata.accessType || '',
        'Key Pickup Location': metadata.keyPickupLocation || '',
        'Square Footage': metadata.squareFootage ? parseInt(metadata.squareFootage) : undefined,
        'Square Footage Fee': metadata.squareFootageFee ? parseFloat(metadata.squareFootageFee) : 0,
        
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
      };

      console.log('Creating Airtable booking record');
      console.log('User linked:', userId ? 'Yes (Registered)' : 'No (Guest)');

      const bookingRecord = await base('Bookings').create([{ fields: bookingFields }]);

      console.log('✅ Booking created from webhook:', bookingRecord[0].id);

      let trackingCode = '';
      
      try {
        const { createActiveBooking } = require('./create-active-booking');
        
        const activeBookingData = {
          bookingRef: bookingRef,
          propertyAddress: metadata.propertyAddress,
          postcode: metadata.postcode,
          clientName: metadata.clientName,
          clientEmail: metadata.clientEmail,
          clientPhone: metadata.clientPhone,
          service: metadata.service,
          date: metadata.date,
          time: metadata.time,
          region: capitalizedRegion,
          mediaSpecialist: metadata.mediaSpecialist,
          bookingStatus: 'Confirmed',
          paymentStatus: 'Paid',
          addons: addons
        };

        const activeBookingResult = await createActiveBooking(activeBookingData);
        
        if (activeBookingResult.success) {
          trackingCode = activeBookingResult.trackingCode || '';
          console.log(`✓ Active Booking created with ID: ${activeBookingResult.activeBookingId}`);
          console.log(`✓ Tracking Code: ${trackingCode}`);
          console.log(`✓ QC Delivery folder created`);
        } else {
          console.error('⚠️ Active Booking creation failed:', activeBookingResult.error);
        }

      } catch (activeBookingError) {
        console.error('Error creating Active Booking:', activeBookingError);
      }

      if (process.env.RESEND_API_KEY) {
        try {
          const { sendBookingConfirmation } = require('./email-service');
          
          const emailData = {
            bookingRef: bookingRef,
            clientName: metadata.clientName,
            clientEmail: metadata.clientEmail,
            service: metadata.service,
            date: metadata.date,
            time: metadata.time,
            propertyAddress: metadata.propertyAddress,
            postcode: metadata.postcode,
            mediaSpecialist: metadata.mediaSpecialist,
            totalPrice: totalPrice,
            duration: parseInt(metadata.duration) || 90,
            paymentStatus: 'Paid',
            bookingStatus: 'Confirmed',
            createdBy: 'Customer',
            cardLast4: '',
            discountCode: discountCode,
            discountAmount: discountAmount,
            trackingCode: trackingCode,
            region: capitalizedRegion,
            accessType: metadata.accessType || '',
            keyPickupLocation: metadata.keyPickupLocation || '',
            squareFootage: metadata.squareFootage ? parseInt(metadata.squareFootage) : null,
            addons: addons
          };
          
          await sendBookingConfirmation(emailData);
          console.log(`✓ Confirmation email sent to ${metadata.clientEmail}`);
          
        } catch (emailError) {
          console.error('Error sending confirmation email:', emailError);
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          received: true, 
          bookingId: bookingRecord[0].id, 
          action: 'created',
          userType: userId ? 'registered' : 'guest'
        })
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

// Send cancellation confirmation email
async function sendCancellationConfirmation(metadata, session, cancellationFee, region = '') {
  if (!process.env.RESEND_API_KEY) {
    console.log('Resend not configured - skipping email');
    return;
  }

  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const refundAmount = parseFloat(metadata.originalTotalPrice) - cancellationFee;

    const bccRecipients = ['commercial@markebmedia.com'];
    
    if (region) {
      if (region.toLowerCase() === 'north') {
        bccRecipients.push('James Jago.Hamshaw@markebmedia.com');
        console.log('✓ BCC: Adding James Jago (North region)');
      }
    }

    await resend.emails.send({
      from: 'Markeb Media <commercial@markebmedia.com>',
      to: metadata.clientEmail,
      bcc: bccRecipients,
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