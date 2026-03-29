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
      <div class="detail-row">
        <span class="detail-label">Total Amount</span>
        <span class="detail-value">£${booking.totalPrice.toFixed(2)}</span>
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
            ? `We'll charge your card ending in ${booking.cardLast4} automatically once your content enters the editing stage.`
            : 'We\'ll charge your card automatically once your content enters the editing stage.'}
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
      <a href="${manageUrl}" class="button">Manage Your Booking</a>
    </center>

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

  const bccRecipients = [BCC_EMAIL];
  
  if (booking.region) {
    if (booking.region.toLowerCase() === 'north') {
      bccRecipients.push('Jodie.Hamshaw@markebmedia.com');
    } else if (booking.region.toLowerCase() === 'south') {
      bccRecipients.push('Maeve.Darley@markebmedia.com');
    }
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
        <span class="detail-label">Amount Paid</span>
        <span class="detail-value">£${booking.amountPaid.toFixed(2)}</span>
      </div>
    </div>

    <div class="alert alert-success">
      <strong>💳 Payment Received</strong><br>
      We've received your payment of £${booking.amountPaid.toFixed(2)}. You're all set!
    </div>

    <center>
      <a href="${manageUrl}" class="button">Manage Your Booking</a>
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
      <a href="${manageUrl}" class="button">Manage Your Booking</a>
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

  await resend.emails.send({
    from: FROM_EMAIL,
    to: booking.clientEmail,
    bcc: BCC_EMAIL,
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
      <a href="${manageUrl}" class="button">Manage Your Booking</a>
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

module.exports = {
  sendBookingConfirmation,
  sendPaymentConfirmation,
  sendRescheduleConfirmation,
  sendCancellationConfirmation,
  sendReminderEmail,
  sendServiceModificationConfirmation
};