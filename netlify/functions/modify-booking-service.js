// netlify/functions/modify-booking-service.js
// UPDATED: Now syncs changes to Active Bookings table
const Airtable = require('airtable');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  console.log('=== Modify Booking Service Function ===');
  
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
    const {
      bookingId,
      bookingRef,
      clientEmail,
      newServiceId,
      newServiceName,
      newServicePrice,
      newServiceDuration,
      bedrooms,
      extraBedroomFee,
      addons,
      addonsPrice,
      totalPrice
    } = JSON.parse(event.body);

    console.log('Modifying booking:', bookingRef);
console.log('New service:', newServiceName);
console.log('New total:', totalPrice);
console.log('Add-ons received:', JSON.stringify(addons));

    // Get existing booking
    const booking = await base('Bookings').find(bookingId);
    const oldTotalPrice = booking.fields['Total Price'];
    const oldFinalPrice = booking.fields['Final Price'] || oldTotalPrice;
    const discountCode = booking.fields['Discount Code'];
    const discountAmount = booking.fields['Discount Amount'] || 0;

    // Calculate new final price with discount preservation
    let newFinalPrice = totalPrice;
    let newDiscountAmount = 0;
    let priceBeforeDiscount = totalPrice;

    if (discountCode && discountAmount > 0) {
      // Recalculate discount percentage from original booking
      const discountPercentage = (discountAmount / (oldTotalPrice)) * 100;
      
      // Apply same percentage to new price
      newDiscountAmount = totalPrice * (discountPercentage / 100);
      newFinalPrice = totalPrice - newDiscountAmount;
      priceBeforeDiscount = totalPrice;

      console.log('Discount preserved:', {
        code: discountCode,
        oldPercentage: discountPercentage,
        newDiscount: newDiscountAmount,
        newFinal: newFinalPrice
      });
    }

    const priceDifference = newFinalPrice - oldFinalPrice;

    console.log('Price calculation:', {
      oldTotal: oldTotalPrice,
      oldFinal: oldFinalPrice,
      newTotal: totalPrice,
      newFinal: newFinalPrice,
      difference: priceDifference
    });

    // Update booking in Airtable
    const updateFields = {
      'Service': newServiceName,
      'Service ID': newServiceId,
      'Duration (mins)': newServiceDuration,
      'Base Price': newServicePrice,
      'Bedrooms': bedrooms,
      'Extra Bedroom Fee': extraBedroomFee,
      'Add-Ons': JSON.stringify(addons),
      'Add-Ons Price': addonsPrice,
      'Total Price': totalPrice,
      'Price Before Discount': priceBeforeDiscount,
      'Discount Amount': newDiscountAmount,
      'Final Price': newFinalPrice,
      'Service Modified': true,
      'Service Modified Date': new Date().toISOString()
    };

    await base('Bookings').update(bookingId, updateFields);

    console.log('✅ Booking updated successfully');

    // ✅ NEW: Update Active Bookings record to match
    try {
      const bookingRefValue = bookingRef || booking.fields['Booking Reference'];
      
      const activeBookings = await base('tblRgcv7M9dUU3YuL')
        .select({
          filterByFormula: `{Booking ID} = '${bookingRefValue}'`,
          maxRecords: 1
        })
        .firstPage();

      if (activeBookings && activeBookings.length > 0) {
        const activeBookingId = activeBookings[0].id;
        
        const addonsLabel = addons && addons.length > 0
  ? ' + ' + addons.map(a => a.name).join(' + ')
  : '';

await base('tblRgcv7M9dUU3YuL').update(activeBookingId, {
  'Service Type': `${newServiceName}${addonsLabel}`,
  'Shoot Date': booking.fields['Date']
});
        
        console.log(`✓ Active Booking synced with modified service`);
      } else {
        console.log(`⚠️ No Active Booking found for ${bookingRefValue}`);
      }
    } catch (activeBookingError) {
      console.error('Error syncing Active Booking:', activeBookingError);
    }

    // Handle payment difference
    let paymentAction = 'none';
    let paymentDetails = null;

    if (Math.abs(priceDifference) > 0.01) {
      const paymentStatus = booking.fields['Payment Status'];
      
      if (priceDifference > 0) {
        // Price increased - don't auto-charge, just update
        paymentAction = 'price_increased';
        paymentDetails = { 
          additionalAmount: priceDifference,
          note: 'Price updated - manual charge required if needed'
        };
        
        console.log(`Price increased by £${priceDifference.toFixed(2)} - no auto-charge`);

      } else if (priceDifference < 0 && paymentStatus === 'Paid') {
        // Price decreased and already paid - process refund
        paymentAction = 'refund';
        
        const stripePaymentIntentId = booking.fields['Stripe Payment Intent ID'];

        if (stripePaymentIntentId) {
          try {
            const refund = await stripe.refunds.create({
              payment_intent: stripePaymentIntentId,
              amount: Math.round(Math.abs(priceDifference) * 100),
              reason: 'requested_by_customer',
              metadata: {
                bookingRef: bookingRef,
                type: 'service_modification',
                originalPrice: oldFinalPrice.toFixed(2),
                newPrice: newFinalPrice.toFixed(2)
              }
            });

            paymentDetails = {
              refundAmount: Math.abs(priceDifference),
              refundId: refund.id
            };

            console.log('✅ Refund processed:', refund.id);

          } catch (error) {
            console.error('⚠️ Refund failed:', error);
            paymentAction = 'refund_failed';
            paymentDetails = { error: error.message };
          }
        }
      }
    }

    // Send confirmation email
if (process.env.RESEND_API_KEY) {
  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    let paymentNote = '';
    if (paymentAction === 'charge' && paymentDetails) {
      paymentNote = `
        <div style="margin: 20px 0; padding: 16px; background-color: #fff8ee; border: 2px solid #B46100; border-radius: 8px;">
          <p style="margin: 0 0 4px; color: #8a4a00; font-size: 15px; font-weight: 700;">💳 Additional Charge</p>
          <p style="margin: 0; color: #8a4a00; font-size: 14px; line-height: 1.6;">£${priceDifference.toFixed(2)} has been charged to your saved payment method.</p>
        </div>`;
    } else if (paymentAction === 'refund' && paymentDetails) {
      paymentNote = `
        <div style="margin: 20px 0; padding: 16px; background-color: #f3f7e8; border: 2px solid #3F4D1B; border-radius: 8px;">
          <p style="margin: 0 0 4px; color: #3F4D1B; font-size: 15px; font-weight: 700;">✅ Refund Processed</p>
          <p style="margin: 0; color: #6b7c2e; font-size: 14px; line-height: 1.6;">£${Math.abs(priceDifference).toFixed(2)} has been refunded to your original payment method within 5–7 business days.</p>
        </div>`;
    } else if (paymentAction === 'charge_required') {
      paymentNote = `
        <div style="margin: 20px 0; padding: 16px; background-color: #fff8ee; border: 2px solid #B46100; border-radius: 8px;">
          <p style="margin: 0 0 4px; color: #8a4a00; font-size: 15px; font-weight: 700;">⚠️ Payment Required</p>
          <p style="margin: 0; color: #8a4a00; font-size: 14px; line-height: 1.6;">An additional £${priceDifference.toFixed(2)} is due. We'll contact you to collect payment.</p>
        </div>`;
    }

    // ✅ Determine BCC recipients based on region
    const bccRecipients = ['commercial@markebmedia.com'];
    if (booking.fields['Region']) {
      if (booking.fields['Region'].toLowerCase() === 'north') {
        bccRecipients.push('James Jago.Hamshaw@markebmedia.com');
        console.log('✓ BCC: Adding James Jago (North region)');
      } else if (booking.fields['Region'].toLowerCase() === 'south') {
        bccRecipients.push('andrii.Hutovych@markebmedia.com');
        console.log('✓ BCC: Adding Andrii (South region)');
      }
    }

    await resend.emails.send({
      from: 'Markeb Media <commercial@markebmedia.com>',
      to: clientEmail,
      bcc: bccRecipients,
      subject: `Booking Modified - ${bookingRef}`,
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
              <h1 style="margin: 0; color: #FDF3E2; font-size: 28px; font-weight: 600; letter-spacing: -0.02em;">Booking Modified</h1>
              <p style="margin: 10px 0 0; color: rgba(253,243,226,0.8); font-size: 15px;">Your booking details have been updated</p>
              <div style="width: 40px; height: 3px; background: #B46100; margin: 16px auto 0; border-radius: 2px;"></div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Hi ${booking.fields['Client Name']},</p>
              <p style="margin: 0 0 25px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Your booking has been successfully modified.</p>

              ${paymentNote}

              <!-- Updated Booking Details -->
              <div style="background-color: #f7ead5; border: 2px solid #e8d9be; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <h3 style="margin: 0 0 16px; color: #3F4D1B; font-size: 16px; font-weight: 700;">Updated Booking Details</h3>
                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600; width: 40%;">Reference</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${bookingRef}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600;">New Service</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${newServiceName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #6b7c2e; font-size: 14px; font-weight: 600;">Date &amp; Time</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e8d9be; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">${booking.fields['Date']} at ${booking.fields['Time']}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7c2e; font-size: 14px; font-weight: 600;">New Total</td>
                    <td style="padding: 10px 0; color: #3F4D1B; font-size: 14px; font-weight: 600; text-align: right;">£${newFinalPrice.toFixed(2)}</td>
                  </tr>
                </table>
              </div>

              <p style="margin: 0 0 6px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Thank you for choosing Markeb Media!</p>
              <p style="margin: 0; color: #6b7c2e; font-size: 14px; line-height: 1.6;">Questions? Contact us at <a href="mailto:commercial@markebmedia.com" style="color: #B46100; text-decoration: none;">commercial@markebmedia.com</a></p>
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
        message: 'Booking modified successfully',
        bookingRef: bookingRef,
        newService: newServiceName,
        newTotal: newFinalPrice,
        priceDifference: priceDifference,
        paymentAction: paymentAction,
        paymentDetails: paymentDetails
      })
    };

  } catch (error) {
    console.error('❌ Error modifying booking:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to modify booking',
        details: error.message
      })
    };
  }
};