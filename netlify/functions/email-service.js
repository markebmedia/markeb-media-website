// netlify/functions/email-service.js

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Markeb Media <bookings@markebmedia.com>';
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
      color: #1e293b;
      background-color: #f8fafc;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      padding: 40px 20px;
      text-align: center;
    }
    .header img {
      height: 50px;
      margin-bottom: 20px;
    }
    .header h1 {
      color: #ffffff;
      margin: 0;
      font-size: 28px;
      font-weight: 700;
    }
    .content {
      padding: 40px 30px;
    }
    .booking-details {
      background-color: #f8fafc;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      margin: 24px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #e2e8f0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      color: #64748b;
      font-weight: 600;
    }
    .detail-value {
      color: #1e293b;
      font-weight: 600;
      text-align: right;
    }
    .button {
      display: inline-block;
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: #ffffff !important;
      padding: 14px 32px;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 600;
      margin: 20px 0;
    }
    .alert {
      padding: 16px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .alert-info {
      background-color: #eff6ff;
      border: 2px solid #3b82f6;
      color: #1e40af;
    }
    .alert-warning {
      background-color: #fef3c7;
      border: 2px solid #f59e0b;
      color: #92400e;
    }
    .alert-success {
      background-color: #f0fdf4;
      border: 2px solid #10b981;
      color: #065f46;
    }
    .footer {
      background-color: #f8fafc;
      padding: 30px;
      text-align: center;
      color: #64748b;
      font-size: 14px;
    }
    .footer a {
      color: #3b82f6;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Markeb Media">
      <h1>Markeb Media</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>
        <strong>Markeb Media</strong><br>
        Professional Property Photography<br>
        <a href="mailto:bookings@markebmedia.com">bookings@markebmedia.com</a>
      </p>
      <p style="margin-top: 20px; font-size: 12px; color: #94a3b8;">
        Need help? <a href="${SITE_URL}/contact">Contact us</a>
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

// 1. Booking Confirmation (Reserve Without Payment)
async function sendBookingConfirmation(booking) {
  const manageUrl = `${SITE_URL}${MANAGE_BOOKING_PATH}?ref=${booking.bookingRef}&email=${encodeURIComponent(booking.clientEmail)}`;
  
  const content = `
    <h2>🎉 Your Shoot is Reserved!</h2>
    <p>Hi ${booking.clientName},</p>
    <p>Great news! Your booking has been confirmed. We're looking forward to capturing amazing content for you.</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Booking Reference</span>
        <span class="detail-value">${booking.bookingRef}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Service</span>
        <span class="detail-value">${booking.service}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Date & Time</span>
        <span class="detail-value">${formatDate(booking.date)} at ${booking.time}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Property Address</span>
        <span class="detail-value">${booking.propertyAddress}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Your Photographer</span>
        <span class="detail-value">${booking.photographer}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Total Amount</span>
        <span class="detail-value">£${booking.totalPrice.toFixed(2)}</span>
      </div>
    </div>

    <div class="alert alert-warning">
      <strong>💳 Payment After Shoot</strong><br>
      We'll charge your card automatically once your content enters the editing stage.
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
      <li><strong>${booking.photographer}</strong> will arrive at your property at ${booking.time}</li>
      <li>The shoot will take approximately ${Math.floor(booking.duration / 60)} hour${booking.duration >= 120 ? 's' : ''}</li>
      <li>You'll receive your edited content within 48 hours</li>
      <li>Payment will be collected automatically after your shoot</li>
    </ul>

    <h3>Preparing for Your Shoot</h3>
    <ul>
      <li>Ensure the property is tidy and well-lit</li>
      <li>Remove personal items, toiletries, and clutter</li>
      <li>Turn on all lights for the best results</li>
      <li>Have access arranged for the photographer</li>
    </ul>

    <p>If you have any questions, feel free to reach out!</p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: booking.clientEmail,
    subject: `Booking Confirmed - ${booking.bookingRef}`,
    html: emailHtml
  });
}

// 2. Payment Confirmation (Stripe)
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
        <span class="detail-value">${booking.service}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Date & Time</span>
        <span class="detail-value">${formatDate(booking.date)} at ${booking.time}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Property Address</span>
        <span class="detail-value">${booking.propertyAddress}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Your Photographer</span>
        <span class="detail-value">${booking.photographer}</span>
      </div>
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
      <li><strong>${booking.photographer}</strong> will arrive at your property at ${booking.time}</li>
      <li>The shoot will take approximately ${Math.floor(booking.duration / 60)} hour${booking.duration >= 120 ? 's' : ''}</li>
      <li>You'll receive your edited content within 48 hours</li>
    </ul>

    <h3>Preparing for Your Shoot</h3>
    <ul>
      <li>Ensure the property is tidy and well-lit</li>
      <li>Remove personal items, toiletries, and clutter</li>
      <li>Turn on all lights for the best results</li>
      <li>Have access arranged for the photographer</li>
    </ul>

    <p>If you have any questions, feel free to reach out!</p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: booking.clientEmail,
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
        <span class="detail-value">${booking.service}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">New Date & Time</span>
        <span class="detail-value">${formatDate(booking.date)} at ${booking.time}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Property Address</span>
        <span class="detail-value">${booking.propertyAddress}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Your Photographer</span>
        <span class="detail-value">${booking.photographer}</span>
      </div>
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
        <span class="detail-value">${booking.service}</span>
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
        <span class="detail-label">Date & Time</span>
        <span class="detail-value">${formatDate(booking.date)} at ${booking.time}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Property Address</span>
        <span class="detail-value">${booking.propertyAddress}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Your Photographer</span>
        <span class="detail-value">${booking.photographer}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Service</span>
        <span class="detail-value">${booking.service}</span>
      </div>
    </div>

    <div class="alert alert-info">
      <strong>📸 Final Preparations</strong><br>
      Please ensure the property is prepared and ready for the shoot.
    </div>

    <h3>Quick Checklist</h3>
    <ul>
      <li>✅ Property is clean and tidy</li>
      <li>✅ Personal items and clutter removed</li>
      <li>✅ All lights turned on</li>
      <li>✅ Access arranged for photographer</li>
      <li>✅ Pets secured (if applicable)</li>
    </ul>

    <p>Looking forward to creating amazing content for you!</p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;

  const emailHtml = getEmailLayout(content);

  await resend.emails.send({
    from: FROM_EMAIL,
    to: booking.clientEmail,
    subject: `Reminder: Your Shoot Tomorrow - ${booking.bookingRef}`,
    html: emailHtml
  });
}

module.exports = {
  sendBookingConfirmation,
  sendPaymentConfirmation,
  sendRescheduleConfirmation,
  sendCancellationConfirmation,
  sendReminderEmail
};