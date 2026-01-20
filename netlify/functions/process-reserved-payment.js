// netlify/functions/process-reserved-payment.js
// Admin function to process payment for a reserved booking
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
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
    const { bookingId, bookingRef } = JSON.parse(event.body);

    if (!bookingId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Booking ID required' })
      };
    }

    // Fetch booking details from Airtable
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
    
    const booking = await base('Bookings').find(bookingId);
    const fields = booking.fields;

    // Verify it's a reserved booking
    if (fields['Payment Status'] !== 'Reserved') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'This booking is not in Reserved status' 
        })
      };
    }

    // Create Stripe payment link
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: fields['Service Name'] || 'Property Photography',
              description: `Booking ${fields['Booking Reference']} - ${fields['Date']} at ${fields['Time']}`
            },
            unit_amount: Math.round(fields['Total Price'] * 100) // Convert to pence
          },
          quantity: 1
        }
      ],
      after_completion: {
        type: 'redirect',
        redirect: {
          url: `https://markebmedia.com/booking-success?ref=${fields['Booking Reference']}`
        }
      },
      metadata: {
        bookingId: bookingId,
        bookingRef: fields['Booking Reference'],
        clientEmail: fields['Client Email'],
        type: 'reserved_booking_payment'
      }
    });

    // Send payment link to customer via email
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: 'Markeb Media <commercial@markebmedia.com>',
      to: fields['Client Email'],
      bcc: 'commercial@markebmedia.com',
      subject: `Payment Required - ${fields['Booking Reference']}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6;">Payment Request</h2>
          
          <p>Hi ${fields['Client Name']},</p>
          
          <p>Your booking is ready for payment.</p>
          
          <div style="background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Booking Details</h3>
            <p><strong>Reference:</strong> ${fields['Booking Reference']}</p>
            <p><strong>Service:</strong> ${fields['Service Name']}</p>
            <p><strong>Date & Time:</strong> ${fields['Date']} at ${fields['Time']}</p>
            <p><strong>Property:</strong> ${fields['Property Address']}</p>
            <p><strong>Amount Due:</strong> £${fields['Total Price'].toFixed(2)}</p>
          </div>
          
          <p style="margin-top: 30px;">
            <a href="${paymentLink.url}" 
               style="background: #3b82f6; color: white; padding: 14px 28px; text-decoration: none; border-radius: 10px; display: inline-block; font-weight: 600;">
              💳 Pay Now
            </a>
          </p>
          
          <p style="color: #64748b; margin-top: 30px;">
            If you have any questions, please contact us at <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
          </p>
          
          <p style="color: #64748b;">
            Best regards,<br>
            The Markeb Media Team
          </p>
        </div>
      `
    });

    // Update booking with payment link info
    await base('Bookings').update(bookingId, {
      'Payment Link': paymentLink.url,
      'Payment Link Created': new Date().toISOString()
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Payment link sent to customer',
        paymentLink: paymentLink.url
      })
    };

  } catch (error) {
    console.error('Error processing payment:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
};