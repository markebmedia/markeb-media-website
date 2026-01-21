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
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background-color: #f4f4f4;">
          <div style="max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff; padding: 40px 30px; text-align: center;">
              <h1 style="margin: 0; font-size: 32px; font-weight: 700;">💳 Payment Required</h1>
              <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Your booking is ready for payment</p>
            </div>
            
            <!-- Body -->
            <div style="padding: 40px 30px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #333333;">Hi <strong>${fields['Client Name']}</strong>,</p>
              
              <p style="margin: 0 0 25px 0; font-size: 16px; line-height: 1.6; color: #333333;">
                Thank you for choosing Markeb Media! Your booking has been reserved and is ready for payment. Please complete payment using the secure link below to confirm your booking.
              </p>
              
              <!-- Booking Details Box -->
              <div style="background: #f8fafc; border-left: 4px solid #3b82f6; padding: 25px; margin: 25px 0; border-radius: 4px;">
                <h3 style="margin: 0 0 15px 0; font-size: 18px; color: #0f172a; font-weight: 600;">📋 Booking Details</h3>
                
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 600;">Reference:</td>
                    <td style="padding: 8px 0; text-align: right; color: #0f172a; font-size: 14px;">${fields['Booking Reference']}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 600;">Service:</td>
                    <td style="padding: 8px 0; text-align: right; color: #0f172a; font-size: 14px;">${fields['Service Name']}</td>
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
                    <td style="padding: 8px 0; text-align: right; color: #0f172a; font-size: 14px;">${fields['Property Address'] || 'N/A'}</td>
                  </tr>
                </table>
              </div>

              <!-- Price Box -->
              <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 12px; padding: 25px; text-align: center; margin: 25px 0;">
                <div style="font-size: 14px; color: #92400e; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Total Amount Due</div>
                <div style="font-size: 48px; font-weight: 700; color: #92400e; margin: 0;">£${fields['Total Price'].toFixed(2)}</div>
              </div>
              
              <!-- CTA Button -->
              <div style="text-align: center; margin: 30px 0;">
                <a href="${paymentLink.url}" 
                   style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; text-decoration: none; padding: 18px 40px; border-radius: 10px; font-weight: 600; font-size: 18px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                  💳 Pay Now - £${fields['Total Price'].toFixed(2)}
                </a>
              </div>

              <!-- Warning Box -->
              <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 25px 0;">
                <p style="margin: 0; font-size: 14px; color: #92400e; line-height: 1.5;">
                  <strong>⚠️ Important:</strong> Your booking will remain in reserved status until payment is completed. Please complete payment as soon as possible to confirm your booking.
                </p>
              </div>
              
              <p style="margin: 25px 0 10px 0; font-size: 15px; line-height: 1.6; color: #64748b;">
                If you have any questions or need assistance, please don't hesitate to contact us at <a href="mailto:commercial@markebmedia.com" style="color: #3b82f6; text-decoration: none;">commercial@markebmedia.com</a>
              </p>
              
              <p style="margin: 30px 0 0 0; font-size: 16px; line-height: 1.6; color: #333333;">
                Best regards,<br>
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