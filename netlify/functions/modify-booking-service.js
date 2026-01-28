// netlify/functions/modify-booking-service.js
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
      'Add-ons Price': addonsPrice,
      'Total Price': totalPrice,
      'Price Before Discount': priceBeforeDiscount,
      'Discount Amount': newDiscountAmount,
      'Final Price': newFinalPrice,
      'Service Modified': true,
      'Service Modified Date': new Date().toISOString()
    };

    await base('Bookings').update(bookingId, updateFields);

    console.log('✅ Booking updated successfully');

    // Handle payment difference
    let paymentAction = 'none';
    let paymentDetails = null;

    if (Math.abs(priceDifference) > 0.01) {
      const paymentStatus = booking.fields['Payment Status'];
      
      if (priceDifference > 0 && paymentStatus === 'Paid') {
        // Additional charge needed
        paymentAction = 'charge';
        
        const stripeCustomerId = booking.fields['Stripe Customer ID'];
        const stripePaymentMethodId = booking.fields['Stripe Payment Method ID'];

        if (stripeCustomerId && stripePaymentMethodId) {
          try {
            // Charge the additional amount
            const paymentIntent = await stripe.paymentIntents.create({
              amount: Math.round(priceDifference * 100),
              currency: 'gbp',
              customer: stripeCustomerId,
              payment_method: stripePaymentMethodId,
              off_session: true,
              confirm: true,
              description: `Service modification charge for ${bookingRef}`,
              metadata: {
                bookingRef: bookingRef,
                type: 'service_modification',
                originalPrice: oldFinalPrice.toFixed(2),
                newPrice: newFinalPrice.toFixed(2)
              }
            });

            paymentDetails = {
              chargeAmount: priceDifference,
              paymentIntentId: paymentIntent.id
            };

            console.log('✅ Additional charge processed:', paymentIntent.id);

          } catch (error) {
            console.error('⚠️ Payment charge failed:', error);
            paymentAction = 'charge_failed';
            paymentDetails = { error: error.message };
          }
        } else {
          paymentAction = 'charge_required';
          paymentDetails = { amount: priceDifference };
        }

      } else if (priceDifference < 0 && paymentStatus === 'Paid') {
        // Refund needed
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
          paymentNote = `<p style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 16px 0;"><strong>Additional Charge:</strong> £${priceDifference.toFixed(2)} has been charged to your saved payment method.</p>`;
        } else if (paymentAction === 'refund' && paymentDetails) {
          paymentNote = `<p style="background: #d1fae5; border: 2px solid #10b981; border-radius: 8px; padding: 16px; margin: 16px 0;"><strong>Refund Processed:</strong> £${Math.abs(priceDifference).toFixed(2)} has been refunded to your original payment method.</p>`;
        } else if (paymentAction === 'charge_required') {
          paymentNote = `<p style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 16px 0;"><strong>Payment Required:</strong> An additional £${priceDifference.toFixed(2)} is due. We'll contact you to collect payment.</p>`;
        }

        await resend.emails.send({
          from: 'Markeb Media <commercial@markebmedia.com>',
          to: clientEmail,
          bcc: 'commercial@markebmedia.com',
          subject: `Booking Modified - ${bookingRef}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff; padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0; font-size: 32px; font-weight: 700;">Booking Modified</h1>
              </div>
              
              <div style="padding: 40px 30px; background: #ffffff;">
                <p style="font-size: 16px; color: #333;">Hi ${booking.fields['Client Name']},</p>
                
                <p style="font-size: 16px; color: #333;">Your booking has been successfully modified.</p>
                
                ${paymentNote}
                
                <div style="background: #f8fafc; border-left: 4px solid #3b82f6; padding: 25px; margin: 25px 0;">
                  <h3 style="margin: 0 0 15px 0; font-size: 18px;">Updated Booking Details</h3>
                  <p><strong>Reference:</strong> ${bookingRef}</p>
                  <p><strong>New Service:</strong> ${newServiceName}</p>
                  <p><strong>Date:</strong> ${booking.fields['Date']} at ${booking.fields['Time']}</p>
                  <p><strong>New Total:</strong> £${newFinalPrice.toFixed(2)}</p>
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