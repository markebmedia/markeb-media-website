// netlify/functions/email-service.js

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const BCC_EMAIL = 'commercial@markebmedia.com';
const SITE_URL = 'https://markebmedia.com';
const LOGO_URL = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';
const MANAGE_BOOKING_PATH = '/manage-booking';

// Format date nicely
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long', 
    year: 'numeric' 
  });
}

// ✅ Format Service with Add-ons
function formatServiceWithAddons(service, addons) {
  if (!addons || addons.length === 0) {
    return service;
  }
  
  const addonNames = addons.map(a => a.name).join(', ');
  return `${service}<br><span style="font-size: 13px; color: #9a7a4a;">Add-ons: ${addonNames}</span>`;
}

// ✅ Bulletproof CTA button — renders correctly in Outlook desktop (VML fallback,
// since Outlook's Word rendering engine ignores CSS gradients and border-radius
// on <a> tags, which was leaving the button text invisible: cream text on a
// transparent/white background instead of the intended solid brand colour)
function getButtonHtml(url, text, width = 260) {
  return `
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="18%" strokecolor="#B46100" fillcolor="#B46100">
<w:anchorlock/>
<center style="color:#FDF3E2;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;">${text}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a href="${url}" target="_blank" style="background-color:#B46100;border-radius:10px;color:#FDF3E2;display:inline-block;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:48px;text-align:center;text-decoration:none;width:${width}px;letter-spacing:0.01em;-webkit-text-size-adjust:none;mso-hide:all;">${text}</a>
<!--<![endif]-->`;
}

// ✅ Format Access Type Information
function getAccessTypeSection(booking) {
  if (!booking.accessType) return '';
  
  let accessDetails = '';
  
  if (booking.accessType === 'Meeting Agent') {
    accessDetails = `
      <div class="detail-row">
        <span class="detail-label">Access Arrangement</span>
        <span class="detail-value">Meeting Agent at Property</span>
      </div>
    `;
  } else if (booking.accessType === 'Meeting Vendor') {
    accessDetails = `
      <div class="detail-row">
        <span class="detail-label">Access Arrangement</span>
        <span class="detail-value">Meeting Vendor at Property</span>
      </div>
    `;
  } else if (booking.accessType === 'Pick Up Keys') {
    accessDetails = `
      <div class="detail-row">
        <span class="detail-label">Access Arrangement</span>
        <span class="detail-value">Pick Up Keys from Office</span>
      </div>
      ${booking.keyPickupLocation ? `
      <div class="detail-row">
        <span class="detail-label">Key Pickup Location</span>
        <span class="detail-value">${booking.keyPickupLocation}</span>
      </div>
      ` : ''}
    `;
  }
  
  return accessDetails;
}

// ✅ Format Local Area Places
function getLocalAreaPlacesSection(booking) {
  const hasLocalAreaHighlights =
    booking.serviceId === 'gold-package' ||
    (booking.addons || []).some(a => a.id === 'local-area-highlights' || a.name === 'Local Area Highlights');

  if (!hasLocalAreaHighlights || !booking.localPlaces || booking.localPlaces.length === 0) return '';

  const placesList = booking.localPlaces
    .map((place, i) => `<li style="margin-bottom: 6px;"><strong>${i + 1}.</strong> ${place}</li>`)
    .join('');

  return `
    <div class="detail-row">
      <span class="detail-label">Local Area Places</span>
      <span class="detail-value">
        <ul style="margin: 0; padding-left: 16px; text-align: left;">
          ${placesList}
        </ul>
      </span>
    </div>
  `;
}

// ✅ Format Square Footage Information
function getSquareFootageSection(booking) {
  if (!booking.squareFootage) return '';
  
  const isLarge = booking.squareFootage > 3000;
  
  return `
    <div class="detail-row">
      <span class="detail-label">Property Size</span>
      <span class="detail-value">
        ${booking.squareFootage} sq ft
        ${isLarge ? '<br><span style="font-size:12px;color:#92400e;background:#fef3c7;border:1px solid #f59e0b;padding:2px 8px;border-radius:4px;font-weight:600;">Large Property</span>' : ''}
      </span>
    </div>
  `;
}

// ✅ Format Personal Branding Answers
function getBrandingAnswersSection(booking) {
  const answers = booking.brandingAnswers;
  if (!answers || Object.keys(answers).length === 0) return '';

  const QUESTIONS = [
    'Area of specialisation',
    'Brand in 3 words',
    'Ideal client',
    'What makes you different',
    'Preferred filming style',
    'Existing brand materials',
    'Where you want to be seen',
    'Specific locations to feature',
    'How viewers should feel',
    'Not comfortable with on camera'
  ];

  const rows = QUESTIONS.map((q, i) => {
    const val = answers[`q${i + 1}`];
    if (!val) return '';
    return `
      <div class="detail-row">
        <span class="detail-label">${i + 1}. ${q}</span>
        <span class="detail-value" style="text-align: left;">${val}</span>
      </div>
    `;
  }).filter(Boolean).join('');

  if (!rows) return '';

  return `
    <h3>🎬 Personal Brand Brief</h3>
    <div class="booking-details">
      ${rows}
    </div>
  `;
}

// ✅ Format EPC Answers (internal email only — for forwarding to EPC partner)
function getEpcAnswersSection(booking) {
  const epc = booking.epcAnswers;
  if (!epc || !Object.values(epc).some(v => v)) return '';

  return `
    <h3>⚡ EPC Information</h3>
    <div class="booking-details">
      ${epc.propertyAge ? `
      <div class="detail-row">
        <span class="detail-label">Age of Property</span>
        <span class="detail-value">${epc.propertyAge}</span>
      </div>` : ''}
      ${epc.extensionAge ? `
      <div class="detail-row">
        <span class="detail-label">Age of Extensions</span>
        <span class="detail-value">${epc.extensionAge}</span>
      </div>` : ''}
      ${epc.loftConversion ? `
      <div class="detail-row">
        <span class="detail-label">Loft Conversion</span>
        <span class="detail-value">${epc.loftConversion}</span>
      </div>` : ''}
      ${epc.solarPanels ? `
      <div class="detail-row">
        <span class="detail-label">Solar Panels</span>
        <span class="detail-value">
          ${epc.solarPanels}
          ${epc.solarPanels === 'Yes' ? '<br><span style="font-size:12px;color:#92400e;background:#fef3c7;border:1px solid #f59e0b;padding:2px 8px;border-radius:4px;font-weight:600;">⚠️ MCS Certificate Required</span>' : ''}
        </span>
      </div>` : ''}
    </div>
    <div style="background:#eff6ff;border:1px solid #3b82f6;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#1e40af;">
      <strong>📋 Forward to EPC partner:</strong> All details above should be passed to your EPC assessor before the visit.
    </div>
  `;
}

// Email Layout Wrapper
function getEmailLayout(content) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markeb Media</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #3F4D1B;
      background-color: #f7ead5;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #FDF3E2;
    }
    .header {
      background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%);
      padding: 40px 20px;
      text-align: center;
    }
    .header img {
      max-width: 200px;
      width: 100%;
      height: auto;
      margin-bottom: 20px;
    }
    .header h1 {
      color: #FDF3E2;
      margin: 0;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .header-accent {
      width: 40px;
      height: 3px;
      background: #B46100;
      margin: 14px auto 0;
      border-radius: 2px;
    }
    .content {
      padding: 40px 30px;
    }
    .content h2 {
      color: #3F4D1B;
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 8px;
    }
    .content h3 {
      color: #3F4D1B;
      font-size: 16px;
      font-weight: 700;
      margin: 24px 0 8px;
    }
    .content p {
      color: #3F4D1B;
      margin: 0 0 14px;
    }
    .content ul {
      color: #3F4D1B;
      padding-left: 20px;
      margin: 0 0 14px;
    }
    .content ul li {
      margin-bottom: 6px;
    }
    .booking-details {
      background-color: #f7ead5;
      border: 2px solid #e8d9be;
      border-radius: 12px;
      padding: 24px;
      margin: 24px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #e8d9be;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      color: #6b7c2e;
      font-weight: 600;
      font-size: 14px;
    }
    .detail-value {
      color: #3F4D1B;
      font-weight: 600;
      text-align: right;
      max-width: 60%;
      font-size: 14px;
    }
    .button {
      display: inline-block;
      background-color: #B46100;
      background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%);
      color: #FDF3E2 !important;
      padding: 14px 32px;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 600;
      margin: 20px 0;
      font-size: 15px;
      letter-spacing: 0.01em;
    }
    .alert {
      padding: 16px;
      border-radius: 8px;
      margin: 20px 0;
      font-size: 14px;
    }
    .alert-info {
      background-color: #fff8ee;
      border: 2px solid #B46100;
      color: #8a4a00;
    }
    .alert-warning {
      background-color: #fef9ec;
      border: 2px solid #cc7a1a;
      color: #7a3e00;
    }
    .alert-success {
      background-color: #f3f7e8;
      border: 2px solid #3F4D1B;
      color: #3F4D1B;
    }
    .footer {
      background-color: #3F4D1B;
      padding: 30px;
      text-align: center;
      color: rgba(253,243,226,0.7);
      font-size: 14px;
    }
    .footer strong {
      color: #FDF3E2;
    }
    .footer a {
      color: #B46100;
      text-decoration: none;
    }
    .footer-divider {
      width: 32px;
      height: 2px;
      background: #B46100;
      margin: 16px auto;
      border-radius: 1px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Markeb Media">
      <h1>Markeb Media</h1>
      <div class="header-accent"></div>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <strong>Markeb Media</strong>
      <div class="footer-divider"></div>
      <p style="margin:0 0 6px;">Professional Property Media, Marketing &amp; Technology Solution</p>
      <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
      <p style="margin-top: 20px; font-size: 12px; color: rgba(253,243,226,0.4);">
        Need help? <a href="${SITE_URL}/contact">Contact us</a>
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

// 1. Booking Confirmation
async function sendBookingConfirmation(booking) {
  const manageUrl = `${SITE_URL}${MANAGE_BOOKING_PATH}?ref=${booking.bookingRef}&email=${encodeURIComponent(booking.clientEmail)}`;
  
  const isPaid = booking.paymentStatus === 'Paid';
  const isAdminBooking = booking.createdBy === 'Admin';
  
  const content = `
    <h2>🎉 Your Shoot is ${isPaid ? 'Confirmed' : 'Reserved'}!</h2>
    <p>Hi ${booking.clientName},</p>
    <p>Great news! Your booking has been confirmed. We're looking forward to capturing amazing content for you.</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Booking Reference</span>
        <span class="detail-value">${booking.bookingRef}</span>
      </div>
      ${booking.trackingCode ? `
      <div class="detail-row">
        <span class="detail-label">Tracking Code</span>
        <span class="detail-value"><strong>${booking.trackingCode}</strong></span>
      </div>
      ` : ''}
      <div class="detail-row">
        <span class="detail-label">Service</span>
        <span class="detail-value">${formatServiceWithAddons(booking.service, booking.addons)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Date &amp; Time</span>
        <span class="detail-value">${formatDate(booking.date)} at ${booking.time}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Property Address</span>
        <span class="detail-value">${booking.propertyAddress}${booking.postcode ? `, ${booking.postcode}` : ''}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Your Media Specialist</span>
        <span class="detail-value">${booking.mediaSpecialist}</span>
      </div>
      ${getAccessTypeSection(booking)}
      ${getSquareFootageSection(booking)}
      ${getLocalAreaPlacesSection(booking)}
      <div class="detail-row">
        <span class="detail-label">Subtotal (ex. VAT)</span>
        <span class="detail-value">£${(booking.totalPrice / 1.2).toFixed(2)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">VAT (20%)</span>
        <span class="detail-value">£${(booking.totalPrice - booking.totalPrice / 1.2).toFixed(2)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Total inc. VAT</span>
        <span class="detail-value"><strong>£${booking.totalPrice.toFixed(2)}</strong></span>
      </div>
    </div>

    ${isPaid ? `
      <div class="alert alert-success">
        <strong>✅ Payment Complete</strong><br>
        Your payment of £${booking.totalPrice.toFixed(2)} has been received. You're all set!
      </div>
    ` : `
      <div class="alert alert-warning">
        <strong>💳 Payment ${isAdminBooking ? 'Pending' : 'After Shoot'}</strong><br>
        ${isAdminBooking 
          ? 'Payment will be collected as arranged.' 
          : booking.cardLast4 
  ? `We'll charge your card ending in ${booking.cardLast4} automatically once your content is delivered.`
  : 'We\'ll charge your card automatically once your content is delivered.'}
      </div>
    `}

    ${booking.accessType ? `
    <div class="alert alert-info">
      <strong>🔑 Property Access Details</strong><br>
      ${booking.accessType === 'Meeting Agent' ? `
        <strong>Meeting Agent at Property</strong><br>
        Your Media Specialist will meet the agent on-site at ${booking.time}.
      ` : booking.accessType === 'Meeting Vendor' ? `
        <strong>Meeting Vendor at Property</strong><br>
        Your Media Specialist will meet the vendor on-site at ${booking.time}.
      ` : booking.accessType === 'Pick Up Keys' ? `
        <strong>Keys to be collected from:</strong><br>
        ${booking.keyPickupLocation || 'Location TBC'}
      ` : ''}
    </div>
    ` : ''}

    <center>
      ${getButtonHtml(manageUrl, 'Manage Your Booking')}
    </center>

    ${getBrandingAnswersSection(booking)}

    <div class="alert alert-info">
      <strong>📅 Need to Reschedule?</strong><br>
      You can reschedule or cancel free of charge up to 24 hours before your shoot.
    </div>

    ${booking.trackingCode ? `
    <div class="alert alert-info">
      <strong>📦 Track Your Content</strong><br>
      Use tracking code <strong>${booking.trackingCode}</strong> to follow your content through production and delivery.
    </div>
    ` : ''}

    <h3>What to Expect</h3>
    <ul>
      <li><strong>${booking.mediaSpecialist}</strong> will arrive at your property at ${booking.time}</li>
      <li>You'll receive your edited content within 48 hours</li>
      ${!isPaid ? '<li>Payment will be collected automatically after your shoot</li>' : ''}
    </ul>

    <h3>Preparing for Your Shoot</h3>
    <ul>
      <li>Ensure the property is tidy and well-lit</li>
      <li>Remove personal items, toiletries, and clutter</li>
      <li>Turn on all lights for the best results</li>
      ${booking.accessType === 'Pick Up Keys' ? '<li>Confirm key pickup location and time with the office</li>' : ''}
      ${booking.accessType === 'Meeting Agent' ? '<li>Ensure the agent will be available at the property at the scheduled time</li>' : ''}
      ${booking.accessType === 'Meeting Vendor' ? '<li>Ensure the vendor will be available at the property at the scheduled time</li>' : ''}
    </ul>

    <p>If you have any questions, feel free to reach out!</p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  const BRANDING_SERVICE_IDS = ['complete-branding', 'branding-video', 'branding-photo'];
  const isBrandingBooking = BRANDING_SERVICE_IDS.includes(booking.serviceId);

  const bccRecipients = [BCC_EMAIL];
  if (isBrandingBooking) {
    bccRecipients.push('marketing@markebmedia.com');
  }
  
  // ── SPECIALIST EMAIL ROUTING ─────────────────────────────────────────────
  // Add a new entry here when hiring a new specialist.
  const SPECIALIST_EMAILS = {
    'Jodie':      'Jodie.Hamshaw@markebmedia.com',
    'James Jago': 'James.Jago@markebmedia.com',
    'Andrii':     'Andrii.Hutovych@markebmedia.com'
  };

  if (booking.mediaSpecialist && SPECIALIST_EMAILS[booking.mediaSpecialist]) {
    bccRecipients.push(SPECIALIST_EMAILS[booking.mediaSpecialist]);
  }

  await resend.emails.send({
    from: FROM_EMAIL,
    to: booking.clientEmail,
    bcc: bccRecipients,
    subject: `Booking ${isPaid ? 'Confirmed' : 'Reserved'} - ${booking.bookingRef}`,
    html: emailHtml
  });

  if (isAdminBooking) {
    const internalContent = `
      <h2>🔔 New Admin Booking Created</h2>
      <p><strong>Admin created a new booking:</strong></p>

      <div class="booking-details">
        <div class="detail-row">
          <span class="detail-label">Booking Reference</span>
          <span class="detail-value">${booking.bookingRef}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Service</span>
          <span class="detail-value">${formatServiceWithAddons(booking.service, booking.addons)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Date &amp; Time</span>
          <span class="detail-value">${formatDate(booking.date)} at ${booking.time}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Property Address</span>
          <span class="detail-value">${booking.propertyAddress}${booking.postcode ? `, ${booking.postcode}` : ''}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Media Specialist</span>
          <span class="detail-value">${booking.mediaSpecialist}</span>
        </div>
        ${getAccessTypeSection(booking)}
        ${getSquareFootageSection(booking)}
        ${booking.clientNotes ? `
        <div class="detail-row">
          <span class="detail-label">Client Notes</span>
          <span class="detail-value" style="text-align:left;">${booking.clientNotes}</span>
        </div>
        ` : ''}
        ${booking.discountCode && booking.discountAmount > 0 ? `
        <div class="detail-row">
          <span class="detail-label">Discount (${booking.discountCode})</span>
          <span class="detail-value" style="color: #3F4D1B;">-£${booking.discountAmount.toFixed(2)}</span>
        </div>
        ` : ''}
        <div class="detail-row">
          <span class="detail-label">Total Amount</span>
          <span class="detail-value">£${booking.totalPrice.toFixed(2)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Payment Status</span>
          <span class="detail-value">${booking.paymentStatus}</span>
        </div>
      </div>

      ${getEpcAnswersSection(booking)}
      ${getBrandingAnswersSection(booking)}
      ${getLocalAreaPlacesSection(booking)}

      <div class="alert alert-info">
        <strong>📧 Customer email sent:</strong> Yes<br>
        <strong>💳 Payment:</strong> ${booking.paymentStatus}
      </div>
    `;

    const internalEmailHtml = getEmailLayout(internalContent);

    await resend.emails.send({
      from: FROM_EMAIL,
      to: BCC_EMAIL,
      subject: `[ADMIN BOOKING] ${booking.bookingRef} - ${booking.clientName}`,
      html: internalEmailHtml
    });
  }
}

// 2. Payment Confirmation
async function sendPaymentConfirmation(booking) {
  const manageUrl = `${SITE_URL}${MANAGE_BOOKING_PATH}?ref=${booking.bookingRef}&email=${encodeURIComponent(booking.clientEmail)}`;
  
  const content = `
    <h2>✅ Payment Confirmed!</h2>
    <p>Hi ${booking.clientName},</p>
    <p>Thank you for your payment! Your booking is now fully confirmed.</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Booking Reference</span>
        <span class="detail-value">${booking.bookingRef}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Service</span>
        <span class="detail-value">${formatServiceWithAddons(booking.service, booking.addons)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Date &amp; Time</span>
        <span class="detail-value">${formatDate(booking.date)} at ${booking.time}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Property Address</span>
        <span class="detail-value">${booking.propertyAddress}${booking.postcode ? `, ${booking.postcode}` : ''}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Your Media Specialist</span>
        <span class="detail-value">${booking.mediaSpecialist}</span>
      </div>
      ${getAccessTypeSection(booking)}
      <div class="detail-row">
        <span class="detail-label">Subtotal (ex. VAT)</span>
        <span class="detail-value">£${(booking.amountPaid / 1.2).toFixed(2)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">VAT (20%)</span>
        <span class="detail-value">£${(booking.amountPaid - booking.amountPaid / 1.2).toFixed(2)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Amount Paid (inc. VAT)</span>
        <span class="detail-value"><strong>£${booking.amountPaid.toFixed(2)}</strong></span>
      </div>
    </div>

    <div class="alert alert-success">
      <strong>💳 Payment Received</strong><br>
      We've received your payment of £${booking.amountPaid.toFixed(2)}. You're all set!
    </div>

    <center>
      ${getButtonHtml(manageUrl, 'Manage Your Booking')}
    </center>

    <div class="alert alert-info">
      <strong>📅 Need to Reschedule?</strong><br>
      You can reschedule or cancel free of charge up to 24 hours before your shoot.
    </div>

    <h3>What to Expect</h3>
    <ul>
      <li><strong>${booking.mediaSpecialist}</strong> will arrive at your property at ${booking.time}</li>
      <li>The shoot will take approximately ${Math.floor(booking.duration / 60)} hour${booking.duration >= 120 ? 's' : ''}</li>
      <li>You'll receive your edited content within 48 hours</li>
    </ul>

    <h3>Preparing for Your Shoot</h3>
    <ul>
      <li>Ensure the property is tidy and well-lit</li>
      <li>Remove personal items, toiletries, and clutter</li>
      <li>Turn on all lights for the best results</li>
      ${booking.accessType === 'Pick Up Keys' ? '<li>Confirm key pickup location and time with the office</li>' : ''}
      ${booking.accessType === 'Meeting Agent' ? '<li>Ensure the agent will be available at the property at the scheduled time</li>' : ''}
      ${booking.accessType === 'Meeting Vendor' ? '<li>Ensure the vendor will be available at the property at the scheduled time</li>' : ''}
    </ul>

    <p>If you have any questions, feel free to reach out!</p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: booking.clientEmail,
    bcc: BCC_EMAIL,
    subject: `Payment Confirmed - ${booking.bookingRef}`,
    html: emailHtml
  });
}

// 3. Reschedule Confirmation
async function sendRescheduleConfirmation(booking, oldDate, oldTime) {
  const manageUrl = `${SITE_URL}${MANAGE_BOOKING_PATH}?ref=${booking.bookingRef}&email=${encodeURIComponent(booking.clientEmail)}`;
  
  const content = `
    <h2>📅 Booking Rescheduled</h2>
    <p>Hi ${booking.clientName},</p>
    <p>Your booking has been successfully rescheduled.</p>

    <div class="alert alert-info">
      <strong>Previous Date:</strong> ${formatDate(oldDate)} at ${oldTime}<br>
      <strong>New Date:</strong> ${formatDate(booking.date)} at ${booking.time}
    </div>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Booking Reference</span>
        <span class="detail-value">${booking.bookingRef}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Service</span>
        <span class="detail-value">${formatServiceWithAddons(booking.service, booking.addons)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">New Date &amp; Time</span>
        <span class="detail-value">${formatDate(booking.date)} at ${booking.time}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Property Address</span>
        <span class="detail-value">${booking.propertyAddress}${booking.postcode ? `, ${booking.postcode}` : ''}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Your Media Specialist</span>
        <span class="detail-value">${booking.mediaSpecialist}</span>
      </div>
      ${getAccessTypeSection(booking)}
    </div>

    <center>
      ${getButtonHtml(manageUrl, 'Manage Your Booking')}
    </center>

    <p>See you on ${formatDate(booking.date)}!</p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: booking.clientEmail,
    bcc: BCC_EMAIL,
    subject: `Booking Rescheduled - ${booking.bookingRef}`,
    html: emailHtml
  });
}

// 4. Cancellation Confirmation
async function sendCancellationConfirmation(booking, cancellationCharge, refundAmount, refundNote) {
  const content = `
    <h2>❌ Booking Cancelled</h2>
    <p>Hi ${booking.clientName},</p>
    <p>Your booking has been cancelled as requested.</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Booking Reference</span>
        <span class="detail-value">${booking.bookingRef}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Original Date</span>
        <span class="detail-value">${formatDate(booking.date)} at ${booking.time}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Service</span>
        <span class="detail-value">${formatServiceWithAddons(booking.service, booking.addons)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Total Amount</span>
        <span class="detail-value">£${booking.totalPrice.toFixed(2)}</span>
      </div>
      ${cancellationCharge > 0 ? `
      <div class="detail-row">
        <span class="detail-label">Cancellation Fee</span>
        <span class="detail-value">£${cancellationCharge.toFixed(2)}</span>
      </div>
      ` : ''}
      <div class="detail-row">
        <span class="detail-label">Refund Amount</span>
        <span class="detail-value">£${refundAmount.toFixed(2)}</span>
      </div>
    </div>

    ${cancellationCharge === 0 ? `
    <div class="alert alert-success">
      <strong>✅ Full Refund</strong><br>
      ${refundNote}
    </div>
    ` : `
    <div class="alert alert-warning">
      <strong>⚠️ Cancellation Fee Applied</strong><br>
      ${refundNote}
    </div>
    `}

    <p>If you'd like to book again in the future, we'd love to work with you!</p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: booking.clientEmail,
    bcc: BCC_EMAIL,
    subject: `Booking Cancelled - ${booking.bookingRef}`,
    html: emailHtml
  });
}

// 5. Reminder Email (24 hours before)
async function sendReminderEmail(booking) {
  const content = `
    <h2>⏰ Reminder: Your Shoot is Tomorrow!</h2>
    <p>Hi ${booking.clientName},</p>
    <p>Just a friendly reminder that your shoot is scheduled for tomorrow.</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Date &amp; Time</span>
        <span class="detail-value">${formatDate(booking.date)} at ${booking.time}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Property Address</span>
        <span class="detail-value">${booking.propertyAddress}${booking.postcode ? `, ${booking.postcode}` : ''}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Your Media Specialist</span>
        <span class="detail-value">${booking.mediaSpecialist}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Service</span>
        <span class="detail-value">${formatServiceWithAddons(booking.service, booking.addons)}</span>
      </div>
      ${getSquareFootageSection(booking)}
      ${getAccessTypeSection(booking)}
    </div>

    ${booking.accessType ? `
    <div class="alert alert-warning">
      <strong>🔑 Property Access Reminder</strong><br>
      ${booking.accessType === 'Meeting Agent' ? `
        Please ensure the agent will be at the property at ${booking.time} to provide access.
      ` : booking.accessType === 'Meeting Vendor' ? `
        Please ensure the vendor will be at the property at ${booking.time} to provide access.
      ` : booking.accessType === 'Pick Up Keys' ? `
        Please confirm keys are available for collection at:<br>
        <strong>${booking.keyPickupLocation}</strong>
      ` : ''}
    </div>
    ` : ''}

    <div class="alert alert-info">
      <strong>📸 Final Preparations</strong><br>
      Please ensure the property is prepared and ready for the shoot.
    </div>

    <h3>Quick Checklist</h3>
    <ul>
      <li>✅ Property is clean and tidy</li>
      <li>✅ Personal items and clutter removed</li>
      <li>✅ All lights turned on</li>
      ${booking.accessType === 'Pick Up Keys' ? '<li>✅ Keys confirmed at pickup location</li>' : ''}
      ${booking.accessType === 'Meeting Agent' ? '<li>✅ Agent confirmed for property access</li>' : ''}
      ${booking.accessType === 'Meeting Vendor' ? '<li>✅ Vendor confirmed for property access</li>' : ''}
      <li>✅ Pets secured (if applicable)</li>
    </ul>

    <p>Looking forward to creating amazing content for you!</p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  const reminderBcc = [BCC_EMAIL];

  const SPECIALIST_EMAILS = {
    'Jodie':      'Jodie.Hamshaw@markebmedia.com',
    'James Jago': 'James.Jago@markebmedia.com',
    'Andrii':     'Andrii.Hutovych@markebmedia.com'
  };

  if (booking.mediaSpecialist && SPECIALIST_EMAILS[booking.mediaSpecialist]) {
    reminderBcc.push(SPECIALIST_EMAILS[booking.mediaSpecialist]);
  }

  await resend.emails.send({
    from: FROM_EMAIL,
    to: booking.clientEmail,
    bcc: reminderBcc,
    subject: `Reminder: Your Shoot Tomorrow - ${booking.bookingRef}`,
    html: emailHtml
  });
}

// 6. Service Modification Confirmation
async function sendServiceModificationConfirmation(booking, oldService, oldPrice, newPrice, priceDifference, paymentAction) {
  const manageUrl = `${SITE_URL}${MANAGE_BOOKING_PATH}?ref=${booking.bookingRef}&email=${encodeURIComponent(booking.clientEmail)}`;
  
  let paymentSection = '';
  
  if (paymentAction === 'charged') {
    paymentSection = `
      <div class="alert alert-info">
        <strong>💳 Payment Processed</strong><br>
        An additional charge of £${priceDifference.toFixed(2)} has been processed to your saved payment method.
      </div>
    `;
  } else if (paymentAction === 'refunded') {
    paymentSection = `
      <div class="alert alert-success">
        <strong>💰 Refund Processed</strong><br>
        A refund of £${Math.abs(priceDifference).toFixed(2)} will be processed to your original payment method within 5-7 business days.
      </div>
    `;
  }
  
  const content = `
    <h2>📝 Service Updated</h2>
    <p>Hi ${booking.clientName},</p>
    <p>Your booking service has been updated as requested.</p>

    <div class="alert alert-warning">
      <strong>Previous Service:</strong><br>
      ${oldService} - £${oldPrice.toFixed(2)}
    </div>

    <div class="alert alert-success">
      <strong>New Service:</strong><br>
      ${formatServiceWithAddons(booking.service, booking.addons)} - £${newPrice.toFixed(2)}
    </div>

    ${paymentSection}

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Booking Reference</span>
        <span class="detail-value">${booking.bookingRef}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Date &amp; Time</span>
        <span class="detail-value">${formatDate(booking.date)} at ${booking.time}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Property Address</span>
        <span class="detail-value">${booking.propertyAddress}${booking.postcode ? `, ${booking.postcode}` : ''}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Your Media Specialist</span>
        <span class="detail-value">${booking.mediaSpecialist}</span>
      </div>
      ${getAccessTypeSection(booking)}
      <div class="detail-row">
        <span class="detail-label">New Total Amount</span>
        <span class="detail-value">£${newPrice.toFixed(2)}</span>
      </div>
    </div>

    <center>
      ${getButtonHtml(manageUrl, 'Manage Your Booking')}
    </center>

    <p>If you have any questions about this change, please don't hesitate to contact us.</p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: booking.clientEmail,
    bcc: BCC_EMAIL,
    subject: `Service Updated - ${booking.bookingRef}`,
    html: emailHtml
  });
}

// 7. Card Update Request (admin-triggered — sends client the update link)
async function sendCardUpdateEmail(booking) {
  const content = `
    <h2>💳 Update Your Payment Details</h2>
    <p>Hi ${booking.clientName},</p>
    <p>We need you to update the payment details we hold on file for your upcoming booking. This is quick and secure — it only takes a minute.</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Booking Reference</span>
        <span class="detail-value">${booking.bookingRef}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Service</span>
        <span class="detail-value">${booking.service || '—'}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Date &amp; Time</span>
        <span class="detail-value">${booking.date ? formatDate(booking.date) : '—'} at ${booking.time || '—'}</span>
      </div>
    </div>

    <div class="alert alert-warning">
      <strong>⚠️ Action Required</strong><br>
      Please update your payment details before your shoot date to ensure everything runs smoothly.
    </div>

    <center>
      ${getButtonHtml(booking.updateLink, 'Update My Payment Details', 300)}
    </center>

    <div class="alert alert-success">
      <strong>🔒 Secure &amp; Encrypted</strong><br>
      Your card details are handled directly by Stripe and are never stored on our servers. You may be asked to authenticate with your bank — this is normal and ensures your card can be safely charged after your shoot.
    </div>

    <p>If you have any questions, feel free to reach out!</p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: booking.clientEmail,
    bcc: BCC_EMAIL,
    subject: `Action Required: Update Your Payment Details — ${booking.bookingRef}`,
    html: emailHtml
  });
}

// 8. Card Updated Confirmation (webhook-triggered — confirms new card saved)
async function sendCardUpdatedConfirmation(booking, bookingsUpdated) {
  const content = `
    <h2>💳 Payment Details Updated</h2>
    <p>Hi ${booking.clientName},</p>
    <p>Your payment details have been updated successfully. Your new card is now on file and will be used for ${bookingsUpdated > 1 ? `all ${bookingsUpdated} of your upcoming bookings` : 'your upcoming booking'}.</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Booking Reference</span>
        <span class="detail-value">${booking.bookingRef}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Status</span>
        <span class="detail-value">✅ Card Updated</span>
      </div>
      ${bookingsUpdated > 1 ? `
      <div class="detail-row">
        <span class="detail-label">Bookings Updated</span>
        <span class="detail-value">${bookingsUpdated} bookings</span>
      </div>
      ` : ''}
    </div>

    <div class="alert alert-success">
      <strong>✅ All Set</strong><br>
      Your new card will be charged automatically once your content has been delivered.
    </div>

    <div class="alert alert-warning">
      <strong>🔒 Didn't make this change?</strong><br>
      If you did not update your payment details, please contact us immediately at <a href="mailto:commercial@markebmedia.com" style="color: #B46100;">commercial@markebmedia.com</a>
    </div>

    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: booking.clientEmail,
    bcc: BCC_EMAIL,
    subject: 'Your Payment Details Have Been Updated',
    html: emailHtml
  });
}

// 9. Review Reward Prize Email
async function sendReviewRewardEmail(clientEmail, clientName, prize) {
  const PRIZE_DETAILS = {
    floor_plan:  {
      name: 'Free Floor Plan',
      desc: 'A professional floor plan will be added to your next booking completely free of charge. No code needed — we\'ll apply it automatically.',
      icon: '🏠',
      code: null
    },
    speed_tour:  {
      name: 'Free Speed Tour',
      desc: 'A complimentary speed tour video will be added to your next shoot at no charge. No code needed — we\'ll apply it automatically.',
      icon: '🎬',
      code: null
    },
    discount_10: {
      name: '10% Off Your Next Booking',
      desc: 'Use the code below at checkout on your next booking to receive 10% off.',
      icon: '🎁',
      code: 'REVIEW10OFF'
    }
  };

  const p = PRIZE_DETAILS[prize] || PRIZE_DETAILS.discount_10;

  const content = `
    <h2>${p.icon} You've won a reward!</h2>
    <p>Hi ${clientName},</p>
    <p>Thank you so much for taking the time to leave us a Google review — it means the world to us and helps other estate agents discover Markeb Media.</p>
    <p>As promised, here's your reward:</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Your Prize</span>
        <span class="detail-value"><strong>${p.name}</strong></span>
      </div>
      ${p.code ? `
      <div class="detail-row">
        <span class="detail-label">Your Discount Code</span>
        <span class="detail-value" style="font-family: monospace; font-size: 18px; letter-spacing: 0.12em; color: #B46100;"><strong>${p.code}</strong></span>
      </div>
      ` : ''}
    </div>

    <div class="alert alert-success">
      <strong>${p.icon} How to claim</strong><br>
      ${p.desc}
    </div>

    <div class="alert alert-info">
      <strong>📅 Valid for your next booking</strong><br>
      Your reward is tied to your account and ready to use on your next shoot with us. Simply book as normal${p.code ? ' and enter the code at checkout' : ' and we\'ll take care of the rest'}.
    </div>

    <center>
      ${getButtonHtml('https://markebmedia.com/website/booking.html', 'Book Your Next Shoot', 280)}
    </center>

    <p>Thank you again for your support — reviews like yours help us grow and keep delivering the best property media in the UK.</p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: clientEmail,
    bcc: BCC_EMAIL,
    subject: `🎁 Your Markeb Media Review Reward — ${p.name}`,
    html: emailHtml
  });
}

// 10. Time Request — Approval
async function sendTimeRequestApproval(f, formattedDate) {
  const html = getEmailLayout(`
    <h2>✅ Your Time Request is Confirmed</h2>
    <p>Hi ${f['Client Name']},</p>
    <p>Great news — we can accommodate your requested time. Your shoot is now in the diary.</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Reference</span>
        <span class="detail-value"><strong>${f['Request Ref']}</strong></span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Date</span>
        <span class="detail-value">${formattedDate}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Time</span>
        <span class="detail-value"><strong>${f['Requested Time']}</strong></span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Postcode</span>
        <span class="detail-value">${f['Postcode'] || '—'}</span>
      </div>
      ${f['Service'] ? `
      <div class="detail-row">
        <span class="detail-label">Service</span>
        <span class="detail-value">${f['Service']}</span>
      </div>` : ''}
    </div>

    <div class="alert alert-info">
      <strong>What happens next?</strong><br>
      Our team will be in touch shortly to complete the booking and collect any remaining details. You'll receive a full booking confirmation once everything is set up.
    </div>

    <p>Questions? <a href="mailto:commercial@markebmedia.com" style="color: #B46100; font-weight: 600;">commercial@markebmedia.com</a></p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: f['Client Email'],
    bcc: BCC_EMAIL,
    subject: `✅ Time Request Approved — ${f['Request Ref']}`,
    html
  });
}

// 11. Time Request — Decline with alternatives
async function sendTimeRequestDecline(f, formattedDate, alternativeDates) {
  const altDatesHtml = alternativeDates
    ? alternativeDates.split('\n').filter(Boolean).map(d => `
        <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; font-size: 14px; color: #1e293b; font-weight: 600;">
          📅 ${d.trim()}
        </div>`).join('')
    : '';

  const html = getEmailLayout(`
    <h2>Re: Your Time Request</h2>
    <p>Hi ${f['Client Name']},</p>
    <p>Thank you for your patience. Unfortunately we're unable to accommodate your requested time:</p>

    <div class="alert alert-warning">
      <strong>${formattedDate} at ${f['Requested Time']}</strong>
    </div>

    ${altDatesHtml ? `
    <p style="font-weight: 700; color: #1e293b; margin-bottom: 12px;">Here are the nearest available alternatives:</p>
    <div style="margin-bottom: 24px;">${altDatesHtml}</div>
    <div class="alert alert-info">
      To book one of these dates, simply reply to this email or get in touch and we'll get it sorted straight away.
    </div>
    ` : `
    <div class="alert alert-info">
      Please get in touch and we'll work with you to find the best available slot.
    </div>
    `}

    <p><strong>Get in touch:</strong><br>
    <a href="mailto:commercial@markebmedia.com" style="color: #B46100; font-weight: 600;">commercial@markebmedia.com</a><br>
    Or reply directly to this email.</p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: f['Client Email'],
    bcc: BCC_EMAIL,
    subject: `Re: Your Time Request — ${f['Request Ref']}`,
    html
  });
}

module.exports = {
  sendBookingConfirmation,
  sendPaymentConfirmation,
  sendRescheduleConfirmation,
  sendCancellationConfirmation,
  sendReminderEmail,
  sendServiceModificationConfirmation,
  sendCardUpdateEmail,
  sendCardUpdatedConfirmation,
  sendReviewRewardEmail,
  sendTimeRequestApproval,
  sendTimeRequestDecline
};