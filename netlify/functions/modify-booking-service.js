// netlify/functions/modify-booking-service.js
const Airtable = require('airtable');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendEpcPartnerNotification } = require('./email-service');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const SPECIALIST_EMAILS = {
  'Jodie':      'Jodie.Hamshaw@markebmedia.com',
  'James Jago': 'James.Jago@markebmedia.com',
  'Andrii':     'Andrii.Hutovych@markebmedia.com'
};

exports.handler = async (event, context) => {
  console.log('=== Modify Booking Service Function ===');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const {
      bookingId,
      newServiceId,
      newServiceName,
      newServicePrice,
      newServiceDuration,
      bedrooms,
      extraBedroomFee,
      addons,
      addonsPrice,
      totalPrice,
      squareFootage,
      squareFootageFee,
      extraDuration,
      epcAnswers,
      brandingAnswers,
      localPlaces,
      sendEmail
    } = JSON.parse(event.body);

    // ── Fetch existing booking ───────────────────────────────────────────────
    const booking = await base('Bookings').find(bookingId);
    const f = booking.fields;

    const bookingRef   = f['Booking Reference'];
    const clientEmail  = f['Client Email'];
    const clientName   = f['Client Name'];
    const oldFinalPrice = parseFloat(f['Final Price'] || 0);

    console.log('Modifying booking:', bookingRef);
    console.log('New service:', newServiceName, '| New total (ex discount):', totalPrice);
    console.log('Add-ons received:', JSON.stringify(addons));

    // ── Discount preservation ────────────────────────────────────────────────
    // Keep the original fixed discount amount as-is; do not recalculate
    // percentages — a £20 code should stay £20 regardless of service change.
    const existingDiscountCode   = f['Discount Code'] || '';
    const existingDiscountAmount = parseFloat(f['Discount Amount'] || 0);

    const priceBeforeDiscount = totalPrice;
    const newFinalPrice       = parseFloat((totalPrice - existingDiscountAmount).toFixed(2));
    const priceDifference     = parseFloat((newFinalPrice - oldFinalPrice).toFixed(2));

    console.log('Price calculation:', {
      oldFinal: oldFinalPrice,
      newBeforeDiscount: priceBeforeDiscount,
      discountPreserved: existingDiscountAmount,
      newFinal: newFinalPrice,
      difference: priceDifference
    });

    // ── Format add-ons (matching create-booking format) ──────────────────────
    const addonsText = addons && addons.length > 0
      ? addons.map(a => `${a.name} (+£${parseFloat(a.price).toFixed(2)})`).join('\n')
      : '';

    const addonsDuration = addons && addons.length > 0
      ? addons.reduce((sum, a) => sum + (parseInt(a.duration) || 0), 0)
      : 0;

    // ── Update Bookings table ────────────────────────────────────────────────
    const totalDuration = (newServiceDuration || 0) + (addonsDuration || 0) + (extraDuration || 0);

    // ── Verify the new duration doesn't create a conflict with other bookings ──
    try {
      const specialistName = f['Media Specialist'];
      const otherBookings = await fetchOtherBookingsForSpecialistOnDate(specialistName, f['Date'], bookingId);
      const overlapCheck = checkDurationOverlap(f['Time'], totalDuration, otherBookings);

      if (overlapCheck.conflict) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: `The new service duration (${totalDuration} mins) would now conflict with another booking at ${overlapCheck.withBooking}. Please reschedule this booking to a different time before applying this service change.`
          })
        };
      }
    } catch (availabilityError) {
      console.error('⚠️ Availability check during modification failed (proceeding anyway):', availabilityError);
    }

    const updateFields = {
      'Service':              newServiceName,
      'Service ID':           newServiceId,
      'Duration (mins)':      totalDuration,
      'Base Price':           newServicePrice,
      'Bedrooms':             bedrooms || 0,
      'Extra Bedroom Fee':    extraBedroomFee || 0,
      'Add-Ons':              addonsText,
      'Add-Ons Price':        addonsPrice || 0,
      'Square Footage':       (squareFootage === null || squareFootage === undefined) ? null : squareFootage,
      'Square Footage Fee':   squareFootageFee || 0,
      'Total Price':          totalPrice,
      'Price Before Discount': priceBeforeDiscount,
      'Discount Code':        existingDiscountCode,
      'Discount Amount':      existingDiscountAmount,
      'Price Ex VAT':         parseFloat((newFinalPrice / 1.2).toFixed(2)),
      'VAT Amount':           parseFloat((newFinalPrice - newFinalPrice / 1.2).toFixed(2)),
      'Final Price':          newFinalPrice,
      ...(epcAnswers && epcAnswers.propertyAge && { 'EPC Property Age': epcAnswers.propertyAge }),
      ...(epcAnswers && epcAnswers.extensionAge && { 'EPC Extension Age': epcAnswers.extensionAge }),
      ...(epcAnswers && epcAnswers.loftConversion && { 'EPC Loft Conversion': epcAnswers.loftConversion }),
      ...(epcAnswers && epcAnswers.solarPanels && { 'EPC Solar Panels': epcAnswers.solarPanels }),
      ...(brandingAnswers && Object.keys(brandingAnswers).length > 0 && { 'Branding Answers': JSON.stringify(brandingAnswers) }),
      // ✅ Explicitly set (not just conditionally add) Local Area Places — if the
      // new service/addons no longer include Local Area Highlights, this clears
      // any stale places left over from a previous service on this booking.
      'Local Area Places': (() => {
        const hasLocalAreaHighlights =
          newServiceId === 'platinum-package' ||
          (addons || []).some(a => a.id === 'local-area-highlights' || a.name === 'Local Area Highlights');
        if (!hasLocalAreaHighlights) return '';
        return (localPlaces && localPlaces.length > 0) ? localPlaces.join('\n') : (f['Local Area Places'] || '');
      })(),
      'Service Modified':     true,
      'Service Modified Date': new Date().toISOString()
    };

    await base('Bookings').update(bookingId, updateFields);
    console.log('✅ Bookings table updated');

    // ── Notify EPC partner if this modification added/kept an EPC add-on ────
    const EPC_PARTNER_REGIONS = ['west', 'north-west', 'north'];
    const hasEpc = (addons || []).some(a => (a.id || '').toLowerCase().startsWith('epc'));
    const bookingRegion = (f['Region'] || '').toLowerCase();

    if (hasEpc && EPC_PARTNER_REGIONS.includes(bookingRegion)) {
      try {
        await sendEpcPartnerNotification({
          bookingRef,
          date: f['Date'],
          time: f['Time'],
          propertyAddress: f['Property Address'],
          postcode: f['Postcode'],
          accessType: f['Access Type'] || '',
          keyPickupLocation: f['Key Pickup Location'] || '',
          region: bookingRegion,
          addons: addons || [],
          epcAnswers: epcAnswers || {
            propertyAge: f['EPC Property Age'] || '',
            extensionAge: f['EPC Extension Age'] || '',
            loftConversion: f['EPC Loft Conversion'] || '',
            solarPanels: f['EPC Solar Panels'] || ''
          }
        });
        console.log('✅ EPC partner notified after modification');
      } catch (epcEmailError) {
        console.error('⚠️ EPC partner notification failed:', epcEmailError);
      }
    }

    // ── Sync Active Bookings table ───────────────────────────────────────────
    try {
      const activeTableId = process.env.AIRTABLE_ACTIVE_BOOKINGS_TABLE || 'tblRgcv7M9dUU3YuL';

      const activeBookings = await base(activeTableId)
        .select({
          filterByFormula: `{Booking ID} = '${bookingRef}'`,
          maxRecords: 1
        })
        .firstPage();

      if (activeBookings && activeBookings.length > 0) {
        const addonsLabel = addons && addons.length > 0
          ? ' + ' + addons.map(a => a.name).join(' + ')
          : '';

        await base(activeTableId).update(activeBookings[0].id, {
          'Service Type': `${newServiceName}${addonsLabel}`,
          'Shoot Date':   f['Date']
        });

        console.log('✅ Active Bookings table synced');
      } else {
        console.log(`⚠️ No Active Booking found for ${bookingRef}`);
      }
    } catch (activeBookingError) {
      console.error('Error syncing Active Bookings:', activeBookingError);
    }

    // ── Handle payment difference ────────────────────────────────────────────
    let paymentAction  = 'none';
    let paymentDetails = null;

    if (Math.abs(priceDifference) > 0.01) {
      const paymentStatus = f['Payment Status'];

      if (priceDifference > 0) {
        paymentAction  = 'price_increased';
        paymentDetails = {
          additionalAmount: priceDifference,
          note: 'Price updated — manual charge required if needed'
        };
        console.log(`Price increased by £${priceDifference.toFixed(2)} — no auto-charge`);

      } else if (priceDifference < 0 && paymentStatus === 'Paid') {
        paymentAction = 'refund';
        const stripePaymentIntentId = f['Stripe Payment Intent ID'];

        if (stripePaymentIntentId) {
          try {
            const refund = await stripe.refunds.create({
              payment_intent: stripePaymentIntentId,
              amount: Math.round(Math.abs(priceDifference) * 100),
              reason: 'requested_by_customer',
              metadata: {
                bookingRef,
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

          } catch (refundError) {
            console.error('⚠️ Refund failed:', refundError);
            paymentAction  = 'refund_failed';
            paymentDetails = { error: refundError.message };
          }
        } else {
          console.log('⚠️ Price decreased but no Stripe Payment Intent ID — skipping refund');
          paymentAction = 'refund_skipped';
        }
      }
    }

    // ── Send confirmation email ──────────────────────────────────────────────
    if (sendEmail !== false && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        let paymentNote = '';
        if (paymentAction === 'price_increased') {
          paymentNote = `
            <div style="margin:20px 0;padding:16px;background:#fff8ee;border:2px solid #B46100;border-radius:8px;">
              <p style="margin:0 0 4px;color:#8a4a00;font-size:15px;font-weight:700;">⚠️ Price Updated</p>
              <p style="margin:0;color:#8a4a00;font-size:14px;line-height:1.6;">The new total for your booking is £${newFinalPrice.toFixed(2)}. We'll be in touch regarding any outstanding balance.</p>
            </div>`;
        } else if (paymentAction === 'refund') {
          paymentNote = `
            <div style="margin:20px 0;padding:16px;background:#f3f7e8;border:2px solid #3F4D1B;border-radius:8px;">
              <p style="margin:0 0 4px;color:#3F4D1B;font-size:15px;font-weight:700;">✅ Refund Processed</p>
              <p style="margin:0;color:#6b7c2e;font-size:14px;line-height:1.6;">£${Math.abs(priceDifference).toFixed(2)} has been refunded to your original payment method within 5–7 business days.</p>
            </div>`;
        } else if (paymentAction === 'refund_failed') {
          paymentNote = `
            <div style="margin:20px 0;padding:16px;background:#fee2e2;border:2px solid #ef4444;border-radius:8px;">
              <p style="margin:0 0 4px;color:#991b1b;font-size:15px;font-weight:700;">⚠️ Refund Pending</p>
              <p style="margin:0;color:#991b1b;font-size:14px;line-height:1.6;">A refund of £${Math.abs(priceDifference).toFixed(2)} is owed. We'll process this manually and be in touch shortly.</p>
            </div>`;
        }

        const bccRecipients = ['commercial@markebmedia.com'];
        const specialist = f['Media Specialist'];
        if (specialist && SPECIALIST_EMAILS[specialist]) {
          bccRecipients.push(SPECIALIST_EMAILS[specialist]);
          console.log(`✓ BCC: Adding ${specialist}`);
        } else if (specialist) {
          try {
            const creatorRecords = await base('Creator Network')
              .select({
                filterByFormula: `AND({Name} = '${specialist.replace(/'/g, "\\'")}', {Status} = 'Active')`,
                maxRecords: 1
              })
              .firstPage();
            if (creatorRecords.length > 0 && creatorRecords[0].fields['Email']) {
              bccRecipients.push(creatorRecords[0].fields['Email']);
              console.log(`✓ BCC: Adding creator ${specialist}`);
            }
          } catch (err) {
            console.error('Error looking up creator email for modify-service BCC:', err);
          }
        }

        const addonsEmailRows = addons && addons.length > 0
          ? addons.map(a => `
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#6b7c2e;font-size:14px;font-weight:600;">Add-on</td>
                <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#3F4D1B;font-size:14px;font-weight:600;text-align:right;">${a.name} (+£${parseFloat(a.price).toFixed(2)})</td>
              </tr>`).join('')
          : '';

        const discountEmailRow = existingDiscountCode && existingDiscountAmount > 0
          ? `<tr>
               <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#6b7c2e;font-size:14px;font-weight:600;">Discount (${existingDiscountCode})</td>
               <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#10b981;font-size:14px;font-weight:600;text-align:right;">−£${existingDiscountAmount.toFixed(2)}</td>
             </tr>`
          : '';

        await resend.emails.send({
          from: 'Markeb Media <commercial@markebmedia.com>',
          to: clientEmail,
          bcc: bccRecipients,
          subject: `Booking Modified — ${bookingRef}`,
          html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background-color:#f7ead5;">
  <table role="presentation" style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:40px 0;text-align:center;background-color:#f7ead5;">
        <table role="presentation" style="max-width:600px;margin:0 auto;background-color:#FDF3E2;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(63,77,27,0.12);">

          <tr>
            <td style="padding:40px 40px 30px;text-align:center;background:linear-gradient(135deg,#3F4D1B 0%,#2d3813 100%);">
              <h1 style="margin:0;color:#FDF3E2;font-size:28px;font-weight:600;letter-spacing:-0.02em;">Booking Modified</h1>
              <p style="margin:10px 0 0;color:rgba(253,243,226,0.8);font-size:15px;">Your booking details have been updated</p>
              <div style="width:40px;height:3px;background:#B46100;margin:16px auto 0;border-radius:2px;"></div>
            </td>
          </tr>

          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 20px;color:#3F4D1B;font-size:16px;line-height:1.6;">Hi ${clientName},</p>
              <p style="margin:0 0 25px;color:#3F4D1B;font-size:16px;line-height:1.6;">Your booking has been successfully modified. Here are the updated details:</p>

              ${paymentNote}

              <div style="background-color:#f7ead5;border:2px solid #e8d9be;border-radius:12px;padding:24px;margin:24px 0;">
                <h3 style="margin:0 0 16px;color:#3F4D1B;font-size:16px;font-weight:700;">Updated Booking Details</h3>
                <table role="presentation" style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#6b7c2e;font-size:14px;font-weight:600;width:40%;">Reference</td>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#3F4D1B;font-size:14px;font-weight:600;text-align:right;">${bookingRef}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#6b7c2e;font-size:14px;font-weight:600;">Service</td>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#3F4D1B;font-size:14px;font-weight:600;text-align:right;">${newServiceName}</td>
                  </tr>
                  ${addonsEmailRows}
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#6b7c2e;font-size:14px;font-weight:600;">Date &amp; Time</td>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#3F4D1B;font-size:14px;font-weight:600;text-align:right;">${f['Date']} at ${f['Time']}</td>
                  </tr>
                  ${discountEmailRow}
                  <tr>
                    <td style="padding:10px 0;color:#6b7c2e;font-size:14px;font-weight:600;">Total</td>
                    <td style="padding:10px 0;color:#3F4D1B;font-size:16px;font-weight:700;text-align:right;">£${newFinalPrice.toFixed(2)}</td>
                  </tr>
                </table>
              </div>

              <p style="margin:0 0 6px;color:#3F4D1B;font-size:16px;line-height:1.6;">Thank you for choosing Markeb Media!</p>
              <p style="margin:0;color:#6b7c2e;font-size:14px;line-height:1.6;">Questions? <a href="mailto:commercial@markebmedia.com" style="color:#B46100;text-decoration:none;">commercial@markebmedia.com</a></p>
            </td>
          </tr>

          <tr>
            <td style="padding:30px 40px;background-color:#3F4D1B;">
              <p style="margin:0 0 4px;color:#FDF3E2;font-size:14px;font-weight:600;">Best regards,</p>
              <p style="margin:0;color:rgba(253,243,226,0.75);font-size:14px;">The Markeb Media Team</p>
              <div style="width:32px;height:2px;background:#B46100;margin:16px 0;border-radius:1px;"></div>
              <p style="margin:0;color:rgba(253,243,226,0.4);font-size:12px;line-height:1.5;">Professional Property Media, Marketing &amp; Technology Solution</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
        });

        console.log('✅ Confirmation email sent to', clientEmail);

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
        bookingRef,
        newService: newServiceName,
        newTotal: newFinalPrice,
        priceDifference,
        paymentAction,
        paymentDetails,
        emailSent: sendEmail !== false
      })
    };

  } catch (error) {
    console.error('❌ Error modifying booking:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to modify booking', details: error.message })
    };
  }
};

// ── Availability helpers (mirrors check-availability.js buffer logic) ────────

async function fetchOtherBookingsForSpecialistOnDate(specialistName, date, excludeBookingId) {
  const filterFormula = `AND(
    {Media Specialist} = '${specialistName}',
    IS_SAME({Date}, '${date}', 'day'),
    OR(
      {Booking Status} = 'Booked',
      {Booking Status} = 'Reserved',
      {Booking Status} = 'Confirmed'
    ),
    RECORD_ID() != '${excludeBookingId}'
  )`;

  const records = await base('Bookings')
    .select({
      filterByFormula: filterFormula,
      sort: [{ field: 'Time', direction: 'asc' }]
    })
    .firstPage();

  return records.map(record => ({
    startTime: record.fields['Time'],
    duration: record.fields['Duration (mins)'] || 90
  }));
}

function checkDurationOverlap(startTime, duration, otherBookings) {
  const fixedBufferMinutes = 45;
  const requestedStart = timeToMinutes(startTime);
  const requestedEnd = requestedStart + duration;
  const requestedEndWithBuffer = requestedEnd + fixedBufferMinutes;

  for (const booking of otherBookings) {
    const bookingStart = timeToMinutes(booking.startTime);
    const bookingEnd = bookingStart + booking.duration;
    const bufferStart = bookingStart - fixedBufferMinutes;
    const bufferEnd = bookingEnd + fixedBufferMinutes;

    if (requestedStart < bufferEnd && requestedEndWithBuffer > bufferStart) {
      return { conflict: true, withBooking: booking.startTime };
    }
  }

  return { conflict: false };
}

function timeToMinutes(timeString) {
  if (!timeString) return 0;
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}