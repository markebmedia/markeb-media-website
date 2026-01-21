// netlify/functions/charge-card.js
// UPDATED: Standardized payment status system with better error handling

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  console.log('=== Charge Card Function (Updated) ===');
  
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
      hasPaymentMethod: !!fields['Stripe Payment Method ID']
    });

    // ✅ FIXED: Check if already paid (standardized)
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

    // Check if payment method exists
    if (!fields['Stripe Payment Method ID']) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'No payment method on file. This booking requires a payment link.',
          bookingRef: fields['Booking Reference'],
          suggestion: 'Use "Send Payment Link" instead'
        })
      };
    }

    const paymentMethodId = fields['Stripe Payment Method ID'];
    console.log('Charging payment method:', paymentMethodId.substring(0, 10) + '...');

    // ✅ ENHANCED: Create or retrieve Stripe customer
    let customerId = fields['Stripe Customer ID'];
    
    if (!customerId) {
      console.log('Creating Stripe customer...');
      
      // Search for existing customer by email
      const customers = await stripe.customers.list({
        email: fields['Client Email'],
        limit: 1
      });

      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        console.log('Found existing customer:', customerId);
      } else {
        // Create new customer
        const customer = await stripe.customers.create({
          email: fields['Client Email'],
          name: fields['Client Name'],
          phone: fields['Client Phone'],
          payment_method: paymentMethodId,
          invoice_settings: {
            default_payment_method: paymentMethodId
          },
          metadata: {
            bookingRef: fields['Booking Reference'],
            source: 'markeb-media-booking',
            region: fields['Region']
          }
        });
        customerId = customer.id;
        console.log('Created new customer:', customerId);
        
        // Update booking with customer ID
        await base('Bookings').update(bookingId, {
          'Stripe Customer ID': customerId
        });
      }
    }

    // ✅ ENHANCED: Charge the card using Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(fields['Total Price'] * 100), // Convert to pence
      currency: 'gbp',
      payment_method: paymentMethodId,
      customer: customerId,
      confirm: true,
      off_session: true, // Allow charging without customer present
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
      receipt_email: fields['Client Email'] // Stripe will send receipt
    });

    console.log('✅ Payment intent created:', paymentIntent.id, 'Status:', paymentIntent.status);

    // ✅ FIXED: Update booking in Airtable with standardized status
    await base('Bookings').update(bookingId, {
      'Payment Status': 'Paid',
      'Booking Status': 'Confirmed',
      'Stripe Payment Intent ID': paymentIntent.id,
      'Payment Date': new Date().toISOString(),
      'Amount Paid': fields['Total Price'],
      'Last Modified': new Date().toISOString()
    });

    console.log('✅ Booking updated in Airtable - Payment Status: Paid');

    // ✅ ENHANCED: Send payment confirmation email with better formatting
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);

      await resend.emails.send({
        from: 'Markeb Media <commercial@markebmedia.com>',
        to: fields['Client Email'],
        bcc: 'commercial@markebmedia.com',
        subject: `Payment Confirmed - ${fields['Booking Reference']}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              
              <!-- Header -->
              <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; padding: 40px 30px; text-align: center;">
                <div style="font-size: 48px; margin-bottom: 10px;">✅</div>
                <h1 style="margin: 0; font-size: 32px; font-weight: 700;">Payment Confirmed!</h1>
                <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Your booking is now confirmed</p>
              </div>
              
              <!-- Body -->
              <div style="padding: 40px 30px;">
                <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #333333;">Hi <strong>${fields['Client Name']}</strong>,</p>
                
                <p style="margin: 0 0 25px 0; font-size: 16px; line-height: 1.6; color: #333333;">
                  Great news! Your payment has been successfully processed and your booking is now confirmed. We're looking forward to working with you!
                </p>
                
                <!-- Payment Confirmation Box -->
                <div style="background: #d1fae5; border: 2px solid #10b981; border-radius: 12px; padding: 20px; margin: 25px 0; text-align: center;">
                  <div style="font-size: 14px; color: #065f46; font-weight: 600; margin-bottom: 8px;">PAYMENT RECEIVED</div>
                  <div style="font-size: 36px; font-weight: 700; color: #065f46;">£${fields['Total Price'].toFixed(2)}</div>
                </div>
                
                <!-- Booking Details Box -->
                <div style="background: #f8fafc; border-left: 4px solid #10b981; padding: 25px; margin: 25px 0; border-radius: 4px;">
                  <h3 style="margin: 0 0 15px 0; font-size: 18px; color: #0f172a; font-weight: 600;">📋 Booking Details</h3>
                  
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 600;">Reference:</td>
                      <td style="padding: 8px 0; text-align: right; color: #0f172a; font-size: 14px; font-weight: 600;">${fields['Booking Reference']}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 600;">Service:</td>
                      <td style="padding: 8px 0; text-align: right; color: #0f172a; font-size: 14px;">${fields['Service']}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 600;">Date:</td>
                      <td style="padding: 8px 0; text-align: right; color: #0f172a; font-size: 14px;">${fields['Date']}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 600;">Time:</td>
                      <td style="padding: 8px 0; text-align: right; color: #0f172a; font-size: 14px;">${fields['Time']}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 600;">Property:</td>
                      <td style="padding: 8px 0; text-align: right; color: #0f172a; font-size: 14px;">${fields['Property Address'] || fields['Postcode']}</td>
                    </tr>
                    ${fields['Media Specialist'] ? `
                    <tr>
                      <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 600;">Media Specialist:</td>
                      <td style="padding: 8px 0; text-align: right; color: #0f172a; font-size: 14px;">${fields['Media Specialist']}</td>
                    </tr>
                    ` : ''}
                    <tr>
                      <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 600;">Amount Paid:</td>
                      <td style="padding: 8px 0; text-align: right; color: #10b981; font-size: 16px; font-weight: 700;">£${fields['Total Price'].toFixed(2)}</td>
                    </tr>
                  </table>
                </div>

                <!-- What's Next Box -->
                <div style="background: #eff6ff; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 25px 0;">
                  <h4 style="margin: 0 0 12px 0; color: #1e40af; font-size: 16px;">📸 What Happens Next?</h4>
                  <ul style="margin: 0; padding-left: 20px; color: #1e40af; font-size: 14px; line-height: 1.8;">
                    <li>You'll receive a reminder email 24 hours before your shoot</li>
                    <li>Our media specialist will arrive at the scheduled time</li>
                    <li>You'll receive your finished content within the agreed timeframe</li>
                  </ul>
                </div>
                
                <p style="margin: 25px 0 10px 0; font-size: 15px; line-height: 1.6; color: #64748b;">
                  If you need to make any changes to your booking or have questions, please contact us at <a href="mailto:commercial@markebmedia.com" style="color: #3b82f6; text-decoration: none;">commercial@markebmedia.com</a>
                </p>
                
                <p style="margin: 30px 0 0 0; font-size: 16px; line-height: 1.6; color: #333333;">
                  Thank you for choosing Markeb Media!<br>
                  <strong>The Markeb Media Team</strong>
                </p>
              </div>
              
              <!-- Footer -->
              <div style="background: #f8fafc; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                <p style="margin: 0 0 5px 0; font-size: 14px; color: #64748b; font-weight: 600;">Markeb Media</p>
                <p style="margin: 0 0 10px 0; font-size: 13px; color: #94a3b8;">Premium Property Marketing</p>
                <p style="margin: 0; font-size: 12px; color: #94a3b8;">This is an automated email. Please do not reply directly to this message.</p>
              </div>
              
            </div>
          </body>
          </html>
        `
      });

      console.log('✅ Payment confirmation sent to:', fields['Client Email']);
    } catch (emailError) {
      console.error('⚠️ Failed to send payment confirmation:', emailError);
      // Don't fail the charge if email fails - payment still succeeded
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Payment charged successfully',
        amount: fields['Total Price'],
        paymentIntentId: paymentIntent.id,
        bookingRef: fields['Booking Reference']
      })
    };

  } catch (error) {
    console.error('❌ Error charging card:', error);
    console.error('Error details:', {
      message: error.message,
      type: error.type,
      code: error.code,
      decline_code: error.decline_code
    });

    // ✅ ENHANCED: Better error handling for specific Stripe errors
    if (error.type === 'StripeCardError') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Card payment failed',
          message: error.message,
          decline_code: error.decline_code,
          userMessage: getCardErrorMessage(error.decline_code)
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
          message: 'This card requires 3D Secure verification. Please send a payment link to the customer.',
          userMessage: 'Your card requires additional verification. We will send you a payment link.'
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

// ✅ NEW: Helper function to provide user-friendly error messages
function getCardErrorMessage(declineCode) {
  const errorMessages = {
    'insufficient_funds': 'Your card has insufficient funds. Please use a different payment method.',
    'card_declined': 'Your card was declined. Please contact your bank or use a different card.',
    'expired_card': 'Your card has expired. Please update your payment method.',
    'incorrect_cvc': 'The security code (CVC) is incorrect. Please check and try again.',
    'processing_error': 'A processing error occurred. Please try again in a few moments.',
    'card_not_supported': 'This card type is not supported. Please use a different card.',
    'currency_not_supported': 'Your card does not support GBP transactions.',
    'do_not_honor': 'Your card was declined. Please contact your bank.',
    'lost_card': 'This card has been reported as lost. Please use a different card.',
    'stolen_card': 'This card has been reported as stolen. Please use a different card.'
  };

  return errorMessages[declineCode] || 'Your payment could not be processed. Please contact your bank or use a different payment method.';
}