// netlify/functions/admin-modify-service.js
const Airtable = require('airtable');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

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
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { 
      bookingId, 
      newServiceId, 
      newServiceName, 
      newServicePrice, 
      newServiceDuration,
      bedrooms,
      addons,
      addonsPrice,
      totalPrice,
      sendEmail = true 
    } = JSON.parse(event.body);

    if (!bookingId || !newServiceId || !newServiceName || newServicePrice === undefined || totalPrice === undefined) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    console.log(`[ADMIN] Modifying service for booking ${bookingId}`);

    // Fetch the booking
    const booking = await base('Bookings').find(bookingId);
    const fields = booking.fields;

    // Check if booking is cancelled
    if (fields['Booking Status'] === 'Cancelled') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Cannot modify a cancelled booking' })
      };
    }

    // Store old values
    const oldService = fields['Service'];
    const oldFinalPrice = fields['Final Price'] || fields['Total Price'];

    // ✅ Get discount info if it exists
    const discountCode = fields['Discount Code'] || '';
    const hasDiscount = discountCode && fields['Discount Amount'] > 0;
    
    // Calculate price before discount (what they would have paid without discount)
    const baseBedrooms = 4;
    const actualBedrooms = bedrooms || fields['Bedrooms'] || 0;
    const extraBedrooms = Math.max(0, actualBedrooms - baseBedrooms);
    const extraBedroomFee = extraBedrooms * 30;
    const newAddonsPrice = addonsPrice || 0;

    const priceBeforeDiscount = newServicePrice + extraBedroomFee + newAddonsPrice;

    // ✅ Apply discount if one exists
    let discountAmount = 0;
    let finalPrice = priceBeforeDiscount;

    if (hasDiscount) {
      const discountType = fields['Discount Type'] || 'Fixed Amount'; // Need to store this
      const discountValue = fields['Discount Value'] || fields['Discount Amount'];

      // Recalculate discount based on new price
      if (discountType === 'Percentage') {
        discountAmount = Math.round((priceBeforeDiscount * discountValue) / 100 * 100) / 100;
      } else {
        // Fixed amount - use original discount amount
        discountAmount = discountValue;
      }

      // Make sure discount doesn't exceed total
      discountAmount = Math.min(discountAmount, priceBeforeDiscount);
      finalPrice = priceBeforeDiscount - discountAmount;

      console.log(`Discount applied: ${discountCode} (${discountType}) = -£${discountAmount.toFixed(2)}`);
    } else {
      // No discount - use the total price passed from frontend
      finalPrice = totalPrice;
    }

    const priceDifference = finalPrice - oldFinalPrice;

    console.log('Price calculation:', {
      oldFinalPrice,
      priceBeforeDiscount,
      discountAmount,
      finalPrice,
      priceDifference
    });

    // Prepare add-ons string
    let addonsString = '';
    if (addons && Array.isArray(addons) && addons.length > 0) {
      addonsString = addons.map(a => `${a.name} (+£${a.price.toFixed(2)})`).join('\n');
    }

    const isPaidBooking = fields['Payment Status'] === 'Paid';
    let paymentAction = 'none';
    let stripeTransactionId = '';

    // Handle payment adjustment for paid bookings
    if (isPaidBooking && priceDifference !== 0) {
      try {
        const paymentIntentId = fields['Stripe Payment Intent ID'];
        const customerId = fields['Stripe Customer ID'];
        const paymentMethodId = fields['Stripe Payment Method ID'];
        
        if (priceDifference > 0) {
          // UPGRADE: Charge the difference
          console.log(`Charging additional £${priceDifference.toFixed(2)}`);
          
          // Create or find customer
          let finalCustomerId = customerId;
          if (!finalCustomerId) {
            const customers = await stripe.customers.list({
              email: fields['Client Email'],
              limit: 1
            });
            
            if (customers.data.length > 0) {
              finalCustomerId = customers.data[0].id;
            } else {
              const customer = await stripe.customers.create({
                email: fields['Client Email'],
                name: fields['Client Name'],
                metadata: { bookingRef: fields['Booking Reference'] }
              });
              finalCustomerId = customer.id;
            }
          }

          // Attach payment method if needed
          if (paymentMethodId) {
            try {
              const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
              if (!pm.customer || pm.customer !== finalCustomerId) {
                await stripe.paymentMethods.attach(paymentMethodId, {
                  customer: finalCustomerId
                });
              }
            } catch (attachError) {
              console.error('Payment method attachment error:', attachError);
            }
          }

          const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(priceDifference * 100),
            currency: 'gbp',
            payment_method: paymentMethodId,
            customer: finalCustomerId,
            confirm: true,
            off_session: true,
            description: `Service upgrade - ${fields['Booking Reference']}`,
            metadata: {
              bookingRef: fields['Booking Reference'],
              bookingId: bookingId,
              type: 'service_upgrade',
              oldService: oldService,
              newService: newServiceName
            },
            receipt_email: fields['Client Email']
          });

          stripeTransactionId = paymentIntent.id;
          paymentAction = 'charged';
          console.log(`✅ Additional charge created: ${paymentIntent.id}`);

        } else if (priceDifference < 0) {
          // DOWNGRADE: Refund the difference
          const refundAmount = Math.abs(priceDifference);
          console.log(`Refunding £${refundAmount.toFixed(2)}`);
          
          if (paymentIntentId) {
            const refund = await stripe.refunds.create({
              payment_intent: paymentIntentId,
              amount: Math.round(refundAmount * 100),
              reason: 'requested_by_customer',
              metadata: {
                bookingRef: fields['Booking Reference'],
                bookingId: bookingId,
                type: 'service_downgrade',
                oldService: oldService,
                newService: newServiceName
              }
            });

            stripeTransactionId = refund.id;
            paymentAction = 'refunded';
            console.log(`✅ Refund created: ${refund.id}`);
          }
        }
      } catch (stripeError) {
        console.error('Stripe error:', stripeError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ 
            error: 'Failed to process payment adjustment',
            details: stripeError.message 
          })
        };
      }
    }

    // ✅ Update booking in Airtable with discount fields preserved
    const updateFields = {
      'Service': newServiceName,
      'Service ID': newServiceId,
      'Duration (mins)': newServiceDuration || fields['Duration (mins)'],
      'Bedrooms': actualBedrooms,
      'Base Price': newServicePrice,
      'Extra Bedroom Fee': extraBedroomFee,
      'Add-Ons': addonsString,
      'Add-Ons Price': newAddonsPrice,
      'Price Before Discount': priceBeforeDiscount,
      'Final Price': finalPrice,
      'Service Modified': true,
      'Service Modified Date': new Date().toISOString().split('T')[0],
      'Previous Service': oldService,
      'Previous Price': oldFinalPrice,
      'Price Adjustment': priceDifference
    };

    // ✅ Update discount amount if discount exists
    if (hasDiscount) {
      updateFields['Discount Amount'] = discountAmount;
    }

    await base('Bookings').update(bookingId, updateFields);

    console.log(`✅ Service modified for booking ${fields['Booking Reference']}`);

    // Send service modification email (if enabled)
    if (sendEmail) {
      try {
        await sendServiceModificationEmail({
          clientName: fields['Client Name'],
          clientEmail: fields['Client Email'],
          bookingRef: fields['Booking Reference'],
          date: fields['Date'],
          time: fields['Time'],
          propertyAddress: fields['Property Address'],
          mediaSpecialist: fields['Media Specialist'],
          oldService: oldService,
          newService: newServiceName,
          oldPrice: oldFinalPrice,
          newPrice: finalPrice,
          priceDifference: priceDifference,
          paymentAction: paymentAction,
          discountCode: discountCode,
          discountAmount: discountAmount
        });
        console.log(`Service modification email sent to ${fields['Client Email']}`);
      } catch (emailError) {
        console.error('Failed to send service modification email:', emailError);
      }
    } else {
      console.log('Email notification skipped (admin choice)');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Service modified successfully',
        oldService: oldService,
        newService: newServiceName,
        oldPrice: oldFinalPrice,
        newPrice: finalPrice,
        priceDifference: priceDifference,
        paymentAction: paymentAction,
        stripeTransactionId: stripeTransactionId,
        emailSent: sendEmail
      })
    };

  } catch (error) {
    console.error('Error modifying service:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to modify service',
        details: error.message 
      })
    };
  }
};

// Send service modification email
async function sendServiceModificationEmail(data) {
  if (!process.env.RESEND_API_KEY) {
    console.log('Resend not configured - skipping email');
    return;
  }

  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  const {
    clientName,
    clientEmail,
    bookingRef,
    date,
    time,
    propertyAddress,
    mediaSpecialist,
    oldService,
    newService,
    oldPrice,
    newPrice,
    priceDifference,
    paymentAction,
    discountCode,
    discountAmount
  } = data;

  let paymentMessage = '';
  
  if (paymentAction === 'charged') {
    paymentMessage = `
      <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #1e40af;">💳 Payment Processed</h3>
        <p style="color: #1e40af;">An additional charge of <strong>£${priceDifference.toFixed(2)}</strong> has been processed to your saved payment method.</p>
      </div>
    `;
  } else if (paymentAction === 'refunded') {
    paymentMessage = `
      <div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #065f46;">💰 Refund Processed</h3>
        <p style="color: #065f46;">A refund of <strong>£${Math.abs(priceDifference).toFixed(2)}</strong> will be processed to your original payment method within 5-7 business days.</p>
      </div>
    `;
  }

  // ✅ Add discount info if applicable
  let discountHTML = '';
  if (discountCode && discountAmount > 0) {
    discountHTML = `
      <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #065f46;">🎁 Discount Applied</h3>
        <p style="color: #065f46;">Code: <strong>${discountCode}</strong> - Saving: <strong>£${discountAmount.toFixed(2)}</strong></p>
      </div>
    `;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #3b82f6;">Service Modified</h2>
      
      <p>Hi ${clientName},</p>
      
      <p>Your booking service has been updated.</p>
      
      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #92400e;">Previous Service</h3>
        <p style="color: #92400e;"><strong>${oldService}</strong> - £${oldPrice.toFixed(2)}</p>
      </div>
      
      <div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #065f46;">New Service</h3>
        <p style="color: #065f46;"><strong>${newService}</strong> - £${newPrice.toFixed(2)}</p>
      </div>
      
      ${discountHTML}
      ${paymentMessage}
      
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Booking Details</h3>
        <p><strong>Reference:</strong> ${bookingRef}</p>
        <p><strong>Date & Time:</strong> ${new Date(date).toLocaleDateString('en-GB')} at ${time}</p>
        <p><strong>Property:</strong> ${propertyAddress}</p>
        <p><strong>Media Specialist:</strong> ${mediaSpecialist}</p>
        <p><strong>New Total:</strong> £${newPrice.toFixed(2)}</p>
      </div>
      
      <p>If you have any questions about this change, please don't hesitate to contact us.</p>
      
      <p style="margin-top: 30px;">
        <a href="https://markebmedia.com/manage-booking.html?ref=${bookingRef}&email=${encodeURIComponent(clientEmail)}" 
           style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Manage Your Booking
        </a>
      </p>
      
      <p style="color: #64748b; margin-top: 30px;">
        Questions? Contact us at <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
      </p>
      
      <p style="color: #64748b;">
        Best regards,<br>
        The Markeb Media Team
      </p>
    </div>
  `;

  await resend.emails.send({
    from: 'Markeb Media <commercial@markebmedia.com>',
    to: clientEmail,
    bcc: 'commercial@markebmedia.com',
    subject: `Service Updated - ${bookingRef}`,
    html: html
  });
}