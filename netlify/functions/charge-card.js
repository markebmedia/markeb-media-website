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
        idempotencyKey: `charge-${bookingId}-v2`
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
      'Amount Paid': finalPrice,
      'Price Ex VAT': parseFloat((finalPrice / 1.2).toFixed(2)),
      'VAT Amount': parseFloat((finalPrice - finalPrice / 1.2).toFixed(2))
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
        <div style="margin: 20px 0; padding: 16px; background-color: #f3f7e8; border: 2px solid #3F4D1B; border-radius: 8px;">
          <p style="margin: 0 0 6px; color: #3F4D1B; font-size: 15px; font-weight: 700;">🎁 Discount Applied</p>
          <p style="margin: 0; color: #6b7c2e; font-size: 14px; line-height: 1.6;">
            Code: <strong>${discountCode}</strong><br>
            Original Price: <span style="text-decoration: line-through;">£${priceBeforeDiscount.toFixed(2)}</span><br>
            You Saved: <strong>£${discountAmount.toFixed(2)}</strong>
          </p>
        </div>
      `;
    }

    await resend.emails.send({
      from: 'Markeb Media <commercial@markebmedia.com>',
      to: fields['Client Email'],
      bcc: 'commercial@markebmedia.com',
      subject: `Payment Confirmed - ${fields['Booking Reference']}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f7ead5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 0; text-align: center; background-color: #f7ead5;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #FDF3E2; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(63,77,27,0.12);">

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%);">
              <div style="font-size: 44px; margin-bottom: 12px;">✅</div>
              <h1 style="margin: 0; color: #FDF3E2; font-size: 28px; font-weight: 600; letter-spacing: -0.02em;">Payment Confirmed!</h1>
              <p style="margin: 10px 0 0; color: rgba(253,243,226,0.8); font-size: 15px;">Your booking is fully confirmed</p>
              <div style="width: 40px; height: 3px; background: #B46100; margin: 16px auto 0; border-radius: 2px;"></div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Hi <strong>${fields['Client Name']}</strong>,</p>
              <p style="margin: 0 0 25px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Your payment has been successfully processed!</p>

              <!-- Payment Amount -->
              <div style="background-color: #f3f7e8; border: 2px solid #3F4D1B; border-radius: 12px; padding: 24px; margin: 0 0 24px; text-align: center;">
                <p style="margin: 0 0 6px; color: #6b7c2e; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Payment Received</p>
                <p style="margin: 0; color: #3F4D1B; font-size: 40px; font-weight: 700; line-height: 1.1;">£${finalPrice.toFixed(2)}</p>
              </div>

              <!-- Discount (conditional) -->
              ${discountHTML}

              <!-- Booking Details -->
              <div style="background-color: #f7ead5; border: 2px solid #e8d9be; border-radius: 12px; padding: 24px; margin: 0 0 24px;">
                <h3 style="margin: 0 0 16px; color: #3F4D1B; font-size: 16px; font-weight: 700;">Booking Details</h3>
                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600; width: 40%;">Reference</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${fields['Booking Reference']}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600;">Service</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${fields['Service']}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600;">Date &amp; Time</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${fields['Date']} at ${fields['Time']}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7c2e; font-size: 14px; font-weight: 600;">Property</td>
                    <td style="padding: 10px 0; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${fields['Property Address'] || fields['Postcode']}</td>
                  </tr>
                </table>
              </div>

              <p style="margin: 0 0 6px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Thank you for choosing Markeb Media!</p>
              <p style="margin: 0; color: #6b7c2e; font-size: 14px; line-height: 1.6;">If you have any questions, contact us at <a href="mailto:commercial@markebmedia.com" style="color: #B46100; text-decoration: none;">commercial@markebmedia.com</a></p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #3F4D1B;">
              <p style="margin: 0 0 4px; color: #FDF3E2; font-size: 14px; font-weight: 600;">Best regards,</p>
              <p style="margin: 0; color: rgba(253,243,226,0.75); font-size: 14px;">The Markeb Media Team</p>
              <div style="width: 32px; height: 2px; background: #B46100; margin: 16px 0; border-radius: 1px;"></div>
              <p style="margin: 0; color: rgba(253,243,226,0.4); font-size: 12px; line-height: 1.5;">Professional Property Media, Marketing &amp; Technology Solution</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
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