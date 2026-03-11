// netlify/functions/charge-card.js
// Charges a saved payment method for reserved bookings
// SECURITY UPDATES: idempotency key, intent ID guard, confirm: false pattern

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  console.log('=== Charge Card Function ===');
  
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
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { bookingId } = JSON.parse(event.body);
    console.log('Processing payment for booking:', bookingId);

    // Get booking from Airtable
    const booking = await base('Bookings').find(bookingId);
    const fields = booking.fields;

    console.log('Booking details:', {
      reference: fields['Booking Reference'],
      paymentStatus: fields['Payment Status'],
      hasPaymentMethod: !!fields['Stripe Payment Method ID'],
      hasExistingIntent: !!fields['Stripe Payment Intent ID']
    });

    // ✅ GUARD 1: Check if already paid
    if (fields['Payment Status'] === 'Paid') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'This booking has already been paid',
          bookingRef: fields['Booking Reference']
        })
      };
    }

    // ✅ GUARD 2: Check if a PaymentIntent already exists
    // This prevents double charges if Airtable failed to update last time
    if (fields['Stripe Payment Intent ID']) {
      console.warn('⚠️ PaymentIntent already exists for this booking:', fields['Stripe Payment Intent ID']);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'A charge has already been attempted for this booking',
          paymentIntentId: fields['Stripe Payment Intent ID'],
          userMessage: 'A payment was already processed for this booking. Check the Stripe dashboard before retrying. If the charge failed, contact support.'
        })
      };
    }

    // Check if payment method exists
    if (!fields['Stripe Payment Method ID']) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'No payment method on file',
          bookingRef: fields['Booking Reference'],
          userMessage: 'This booking does not have a saved payment method. Please use "Send Payment Link" instead.'
        })
      };
    }

    const paymentMethodId = fields['Stripe Payment Method ID'];
    console.log('Charging payment method:', paymentMethodId.substring(0, 10) + '...');

    // Create or retrieve Stripe customer
    let customerId = fields['Stripe Customer ID'];
    
    if (!customerId) {
      console.log('Creating Stripe customer...');
      
      const customers = await stripe.customers.list({
        email: fields['Client Email'],
        limit: 1
      });

      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        console.log('Found existing customer:', customerId);
      } else {
        const customer = await stripe.customers.create({
          email: fields['Client Email'],
          name: fields['Client Name'],
          phone: fields['Client Phone'],
          metadata: {
            bookingRef: fields['Booking Reference'],
            source: 'markeb-media-booking',
            region: fields['Region']
          }
        });
        customerId = customer.id;
        console.log('Created new customer:', customerId);
        
        await base('Bookings').update(bookingId, {
          'Stripe Customer ID': customerId
        });
      }
    }

    // Attach payment method to customer
    console.log('Attaching payment method to customer...');
    try {
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
      
      if (!paymentMethod.customer || paymentMethod.customer !== customerId) {
        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: customerId,
        });
        console.log('✅ Payment method attached to customer');
      } else {
        console.log('✅ Payment method already attached');
      }
    } catch (attachError) {
      console.error('⚠️ Error attaching payment method:', attachError);
      
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Payment method cannot be used',
          userMessage: 'This payment method was saved incorrectly and cannot be charged. Please use "Mark as Paid" if they paid another way, or send them a new payment link.',
          bookingRef: fields['Booking Reference']
        })
      };
    }

    // Validate price
    const finalPrice = fields['Final Price'] || 0;
    
    if (finalPrice <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Invalid booking price',
          bookingRef: fields['Booking Reference'],
          userMessage: 'Cannot charge £0.00. Please check the booking details.'
        })
      };
    }

    // ✅ FIX: Create PaymentIntent with confirm: false first
    // This lets us save the intent ID to Airtable BEFORE charging,
    // so we always have a record even if the Airtable update after charging fails.
    // off_session is NOT passed here — it is only valid when confirm: true,
    // so it is passed at the confirm step below instead.
    console.log('Creating PaymentIntent (unconfirmed)...');
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(finalPrice * 100),
        currency: 'gbp',
        payment_method: paymentMethodId,
        customer: customerId,
        confirm: false,
        description: `${fields['Service']} - ${fields['Booking Reference']}`,
        metadata: {
          bookingReference: fields['Booking Reference'],
          bookingId: bookingId,
          clientEmail: fields['Client Email'],
          clientName: fields['Client Name'],
          service: fields['Service'],
          date: fields['Date'],
          time: fields['Time'],
          region: fields['Region'],
          type: 'pending_payment_charge'
        },
        receipt_email: fields['Client Email']
      },
      {
        // ✅ FIX: Idempotency key prevents duplicate charges
        // if this function is called twice for the same booking
        idempotencyKey: `charge-${bookingId}`
      }
    );

    console.log('PaymentIntent created:', paymentIntent.id);

    // ✅ FIX: Save intent ID to Airtable BEFORE confirming payment
    // If the confirmation or subsequent update fails, we still have the intent ID
    // and the admin guard above will catch any retry attempts
    await base('Bookings').update(bookingId, {
      'Stripe Payment Intent ID': paymentIntent.id,
      'Payment Status': 'Processing'
    });

    console.log('✅ Intent ID saved to Airtable - now confirming payment...');

    // Now confirm (charge) the payment.
    // ✅ FIX: off_session: true is passed here at the confirm step,
    // which is the correct place for the two-step create-then-confirm pattern.
    // This tells Stripe the customer is not present and to attempt the charge
    // without requiring real-time authentication.
    const confirmedIntent = await stripe.paymentIntents.confirm(paymentIntent.id, {
      payment_method: paymentMethodId,
      off_session: true,
    });

    console.log('✅ Payment confirmed:', confirmedIntent.id, 'Status:', confirmedIntent.status);

    // Update booking to Paid
    await base('Bookings').update(bookingId, {
      'Payment Status': 'Paid',
      'Booking Status': 'Confirmed',
      'Payment Date': new Date().toISOString(),
      'Amount Paid': finalPrice
    });

    console.log('✅ Booking updated - Payment Status: Paid');

    // Send confirmation email
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        const discountCode = fields['Discount Code'] || '';
        const discountAmount = fields['Discount Amount'] || 0;
        const priceBeforeDiscount = fields['Price Before Discount'] || finalPrice;
        
        let discountHTML = '';
        if (discountCode && discountAmount > 0) {
          discountHTML = `
            <div style="margin-top: 16px; padding: 12px; background: #d1fae5; border-radius: 8px;">
              <div style="font-size: 14px; color: #065f46; font-weight: 600;">🎁 Discount Applied</div>
              <div style="font-size: 13px; color: #047857; margin-top: 4px;">
                Code: <strong>${discountCode}</strong><br>
                Original Price: <span style="text-decoration: line-through;">£${priceBeforeDiscount.toFixed(2)}</span><br>
                You Saved: <strong>£${discountAmount.toFixed(2)}</strong>
              </div>
            </div>
          `;
        }

        await resend.emails.send({
          from: 'Markeb Media <commercial@markebmedia.com>',
          to: fields['Client Email'],
          bcc: 'commercial@markebmedia.com',
          subject: `Payment Confirmed - ${fields['Booking Reference']}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;">
                <div style="font-size: 48px; margin-bottom: 10px;">✅</div>
                <h1 style="margin: 0; font-size: 32px; font-weight: 700;">Payment Confirmed!</h1>
              </div>
              
              <div style="padding: 40px 30px; background: #ffffff;">
                <p style="font-size: 16px; color: #333;">Hi <strong>${fields['Client Name']}</strong>,</p>
                
                <p style="font-size: 16px; color: #333;">Your payment has been successfully processed!</p>
                
                <div style="background: #d1fae5; border: 2px solid #10b981; border-radius: 12px; padding: 20px; margin: 25px 0; text-align: center;">
                  <div style="font-size: 14px; color: #065f46; font-weight: 600;">PAYMENT RECEIVED</div>
                  <div style="font-size: 36px; font-weight: 700; color: #065f46; margin-top: 8px;">£${finalPrice.toFixed(2)}</div>
                </div>
                
                ${discountHTML}
                
                <div style="background: #f8fafc; border-left: 4px solid #10b981; padding: 25px; margin: 25px 0;">
                  <h3 style="margin: 0 0 15px 0; font-size: 18px;">Booking Details</h3>
                  <p><strong>Reference:</strong> ${fields['Booking Reference']}</p>
                  <p><strong>Service:</strong> ${fields['Service']}</p>
                  <p><strong>Date:</strong> ${fields['Date']} at ${fields['Time']}</p>
                  <p><strong>Property:</strong> ${fields['Property Address'] || fields['Postcode']}</p>
                </div>
                
                <p style="font-size: 16px; color: #333;">Thank you for choosing Markeb Media!</p>
              </div>
            </div>
          `
        });

        console.log('✅ Confirmation email sent');
      } catch (emailError) {
        console.error('⚠️ Email failed:', emailError);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Payment charged successfully',
        amount: finalPrice,
        paymentIntentId: confirmedIntent.id,
        bookingRef: fields['Booking Reference']
      })
    };

  } catch (error) {
    console.error('❌ Error charging card:', error);

    if (error.type === 'StripeCardError') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Card payment failed',
          message: error.message,
          userMessage: 'The card payment failed. Please send a payment link instead or contact the customer.'
        })
      };
    }

    if (error.type === 'StripeAuthenticationError') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Card requires authentication',
          userMessage: 'This card requires 3D Secure verification. Please send a payment link instead.'
        })
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to charge card',
        details: error.message
      })
    };
  }
};