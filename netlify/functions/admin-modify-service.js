// netlify/functions/admin-modify-service.js
// UPDATED: Now syncs changes to Active Bookings table
const Airtable = require('airtable');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const { sendEpcPartnerNotification } = require('./email-service');

// ── SPECIALIST EMAIL ROUTING ─────────────────────────────────────────────────
// Add a new entry here when hiring a new specialist.
const SPECIALIST_EMAILS = {
  'Jodie':      'Jodie.Hamshaw@markebmedia.com',
  'James Jago': 'James.Jago@markebmedia.com',
  'Andrii':     'Andrii.Hutovych@markebmedia.com'
};

const EPC_PARTNER_REGIONS = ['west', 'north-west', 'north'];

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
      squareFootage,
      squareFootageFee,
      epcAnswers,
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
    const oldFinalPrice = fields['Final Price'] || 0;

    // Get discount info if it exists
    const discountCode = fields['Discount Code'] || '';
    const hasDiscount = discountCode && fields['Discount Amount'] > 0;
    
    // Calculate price before discount
    const baseBedrooms = 4;
    const actualBedrooms = bedrooms || fields['Bedrooms'] || 0;
    const extraBedrooms = Math.max(0, actualBedrooms - baseBedrooms);
    const extraBedroomFee = extraBedrooms * 25;
    const newAddonsPrice = addonsPrice || 0;

    const sqftFee = squareFootageFee || 0;
    const subtotalExVat = newServicePrice + extraBedroomFee + newAddonsPrice + sqftFee;
const priceBeforeDiscount = parseFloat((subtotalExVat * 1.2).toFixed(2)); // inc VAT

// Apply discount if one exists
let discountAmount = 0;
let finalPrice = priceBeforeDiscount;

if (hasDiscount) {
  const discountType = fields['Discount Type'] || 'Fixed Amount';
  const discountValue = fields['Discount Value'] || fields['Discount Amount'];

  if (discountType === 'Percentage') {
    discountAmount = Math.round((priceBeforeDiscount * discountValue) / 100 * 100) / 100;
  } else {
    discountAmount = discountValue;
  }

  discountAmount = Math.min(discountAmount, priceBeforeDiscount);
  finalPrice = parseFloat((priceBeforeDiscount - discountAmount).toFixed(2));

  console.log(`Discount applied: ${discountCode} (${discountType}) = -£${discountAmount.toFixed(2)}`);
} else {
  // totalPrice passed from frontend is already inc VAT
  finalPrice = parseFloat((subtotalExVat * 1.2).toFixed(2));
}

    const priceDifference = finalPrice - oldFinalPrice;

    // Prepare add-ons string
    let addonsString = '';
    let addonsDuration = 0;
    if (addons && Array.isArray(addons) && addons.length > 0) {
      addonsString = addons.map(a => `${a.name} (+£${a.price.toFixed(2)})`).join('\n');
      addonsDuration = addons.reduce((sum, a) => sum + (parseInt(a.duration) || 0), 0);
    }

    const extraBedroomDuration = extraBedrooms * 5;
    const sqft = fields['Square Footage'] || null;
    let extraSqftDuration = 0;
    if (sqft) {
      if (sqft >= 5000) extraSqftDuration = 20;
      else if (sqft >= 4000) extraSqftDuration = 15;
      else if (sqft > 3000) extraSqftDuration = 10;
    }
    const totalDuration = (newServiceDuration || fields['Duration (mins)'] || 0) + addonsDuration + extraBedroomDuration + extraSqftDuration;

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
          console.log(`Charging additional £${priceDifference.toFixed(2)}`);
          
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

    // ✅ Clear stale Local Area Places if the new service/addons no longer include it
    const hasLocalAreaHighlights =
      newServiceId === 'platinum-package' ||
      (addons || []).some(a => a.id === 'local-area-highlights' || a.name === 'Local Area Highlights');

    if (!hasLocalAreaHighlights && fields['Local Area Places']) {
      console.log('⚠️ Local Area Highlights no longer applicable — clearing stale places data');
    }

    // Update booking in Airtable
    const updateFields = {
      'Service': newServiceName,
      'Service ID': newServiceId,
      'Duration (mins)': totalDuration,
      'Bedrooms': actualBedrooms,
      'Base Price': newServicePrice,
      'Extra Bedroom Fee': extraBedroomFee,
      'Add-Ons': addonsString,
      'Add-Ons Price': newAddonsPrice,
      'Local Area Places': hasLocalAreaHighlights ? fields['Local Area Places'] : '',
      'Price Before Discount': priceBeforeDiscount,
      'Price Ex VAT': parseFloat((finalPrice / 1.2).toFixed(2)),
      'VAT Amount': parseFloat((finalPrice - finalPrice / 1.2).toFixed(2)),
      'Final Price': finalPrice,
      'Service Modified': true,
      'Service Modified Date': new Date().toISOString().split('T')[0],
      'Previous Service': oldService,
      'Previous Price': oldFinalPrice,
      'Price Adjustment': priceDifference,
      'Square Footage': (squareFootage === null || squareFootage === undefined) ? null : squareFootage,
      'Square Footage Fee': sqftFee,
      ...(epcAnswers && epcAnswers.propertyAge && { 'EPC Property Age': epcAnswers.propertyAge }),
      ...(epcAnswers && epcAnswers.extensionAge && { 'EPC Extension Age': epcAnswers.extensionAge }),
      ...(epcAnswers && epcAnswers.loftConversion && { 'EPC Loft Conversion': epcAnswers.loftConversion }),
      ...(epcAnswers && epcAnswers.solarPanels && { 'EPC Solar Panels': epcAnswers.solarPanels })
    };

    if (hasDiscount) {
      updateFields['Discount Amount'] = discountAmount;
    }

    await base('Bookings').update(bookingId, updateFields);

    console.log(`✅ Service modified for booking ${fields['Booking Reference']}`);

    // ── Notify EPC partner if this modification added/kept an EPC add-on ────
    try {
      const hasEpc = (addons || []).some(a => (a.id || '').toLowerCase().startsWith('epc'));
      const bookingRegion = (fields['Region'] || '').toLowerCase();

      if (hasEpc && EPC_PARTNER_REGIONS.includes(bookingRegion)) {
        await sendEpcPartnerNotification({
          bookingRef: fields['Booking Reference'],
          date: fields['Date'],
          time: fields['Time'],
          propertyAddress: fields['Property Address'],
          postcode: fields['Postcode'],
          accessType: fields['Access Type'] || '',
          keyPickupLocation: fields['Key Pickup Location'] || '',
          region: bookingRegion,
          addons: addons || [],
          epcAnswers: epcAnswers || {
            propertyAge: fields['EPC Property Age'] || '',
            extensionAge: fields['EPC Extension Age'] || '',
            loftConversion: fields['EPC Loft Conversion'] || '',
            solarPanels: fields['EPC Solar Panels'] || ''
          }
        });
        console.log('✅ EPC partner notified after modification');
      }
    } catch (epcEmailError) {
      console.error('⚠️ EPC partner notification failed:', epcEmailError);
    }

    // ✅ NEW: Update Active Bookings record to match
    try {
      const bookingRef = fields['Booking Reference'];
      
      const activeBookings = await base('tblRgcv7M9dUU3YuL')
        .select({
          filterByFormula: `{Booking ID} = '${bookingRef}'`,
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
  'Shoot Date': fields['Date']
});
        
        console.log(`✓ Active Booking synced with modified service`);
      } else {
        console.log(`⚠️ No Active Booking found for ${bookingRef}`);
      }
    } catch (activeBookingError) {
      console.error('Error syncing Active Booking:', activeBookingError);
    }

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
          discountAmount: discountAmount,
          region: fields['Region'] // ✅ Pass region
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
        <a href="https://markebmedia.com/website/manage-booking.html?ref=${bookingRef}&email=${encodeURIComponent(clientEmail)}" 
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

  // ✅ Determine BCC recipients based on region
  const bccRecipients = ['commercial@markebmedia.com', 'Jodie.Hamshaw@markebmedia.com'];
  
  if (data.mediaSpecialist && SPECIALIST_EMAILS[data.mediaSpecialist]) {
    bccRecipients.push(SPECIALIST_EMAILS[data.mediaSpecialist]);
    console.log(`✓ BCC: Adding ${data.mediaSpecialist}`);
  }

  await resend.emails.send({
    from: 'Markeb Media <commercial@markebmedia.com>',
    to: clientEmail,
    bcc: bccRecipients, // ✅ Array of BCC recipients
    subject: `Service Updated - ${bookingRef}`,
    html: html
  });
}