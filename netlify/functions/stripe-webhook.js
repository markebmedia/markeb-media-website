// netlify/functions/stripe-webhook.js
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

      // Parse add-ons
      const addons = JSON.parse(metadata.addons || '[]');
      const addonsText = addons.length > 0
        ? addons.map(a => `${a.name} (+£${parseFloat(a.price).toFixed(2)})`).join('\n')
        : '';
      
      // Calculate add-ons price
      const addonsPrice = addons.reduce((sum, a) => sum + parseFloat(a.price || 0), 0);

      // Calculate prices (reconstruct from metadata)
      const totalPrice = session.amount_total / 100;
      const bedrooms = parseInt(metadata.bedrooms) || 0;
      const extraBedrooms = Math.max(0, bedrooms - 4);
      const extraBedroomFee = extraBedrooms * 30;
      const basePrice = totalPrice - extraBedroomFee - addonsPrice;

      // Capitalize region
      const capitalizedRegion = metadata.region 
        ? metadata.region.charAt(0).toUpperCase() + metadata.region.slice(1).toLowerCase()
        : 'Unknown';

      // ✅ CREATE booking with EXACT field names from create-booking.js
      const bookingRecord = await base('Bookings').create([
        {
          fields: {
            'Booking Reference': bookingRef,
            'Date': metadata.date,
            'Time': metadata.time,
            'Postcode': metadata.postcode,
            'Property Address': metadata.propertyAddress,
            'Region': capitalizedRegion, // North or South
            'Media Specialist': metadata.mediaSpecialist,
            'Service': metadata.service, // ✅ Service NAME (not ID)
            'Service ID': metadata.serviceId, // ✅ Service ID
            'Duration (mins)': parseInt(metadata.duration) || 90,
            'Bedrooms': bedrooms,
            'Base Price': basePrice,
            'Extra Bedroom Fee': extraBedroomFee,
            'Add-Ons': addonsText, // ✅ Formatted with prices
            'Add-ons Price': addonsPrice, // ✅ Lowercase 'o'
            'Total Price': totalPrice,
            'Client Name': metadata.clientName,
            'Client Email': metadata.clientEmail,
            'Client Phone': metadata.clientPhone,
            'Client Notes': metadata.clientNotes || '',
            
            // ✅ Payment fields matching create-booking
            'Booking Status': 'Confirmed',
            'Payment Status': 'Paid',
            'Payment Method': 'Stripe',
            'Stripe Session ID': session.id,
            'Stripe Payment Intent ID': session.payment_intent,
            'Payment Date': new Date().toISOString(),
            'Amount Paid': totalPrice,
            
            // Metadata
            'Created Date': new Date().toISOString(),
            'Cancellation Allowed Until': new Date(new Date(metadata.date).getTime() - 24 * 60 * 60 * 1000).toISOString()
          }
        }
      ]);

      console.log('✅ Booking created from webhook:', bookingRecord[0].id);

      // Send payment confirmation email
      await sendPaymentConfirmation(metadata, session, bookingRef);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ received: true, bookingId: bookingRecord[0].id, action: 'created' })
      };

    } catch (error) {
      console.error('❌ Error processing webhook:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack
      });
      
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
async function sendPaymentConfirmation(metadata, session, bookingRef) {
  if (!process.env.RESEND_API_KEY) {
    console.log('Resend not configured - skipping email');
    return;
  }

  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const ref = bookingRef || metadata.bookingRef || 'N/A';
    const amountPaid = session.amount_total / 100;

    await resend.emails.send({
      from: 'Markeb Media <commercial@markebmedia.com>',
      to: metadata.clientEmail,
      bcc: 'commercial@markebmedia.com',
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

    console.log('✅ Payment confirmation email sent to:', metadata.clientEmail);
  } catch (emailError) {
    console.error('⚠️ Failed to send payment confirmation:', emailError);
    // Don't fail webhook if email fails
  }
}