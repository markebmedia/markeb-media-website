// netlify/functions/send-broadcast-email.js
const { Resend } = require('resend');
const Airtable = require('airtable');

const resend = new Resend(process.env.RESEND_API_KEY);
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const BCC_EMAIL = 'commercial@markebmedia.com';
const LOGO_URL = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';

// Email Layout Wrapper (matching email-service.js)
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
      background-color: #3b82f6;
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
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
      color: #ffffff;
      margin: 0;
      font-size: 28px;
      font-weight: 700;
    }
    .content {
      padding: 40px 30px;
    }
    .content h2 {
      color: #1e293b;
      font-size: 24px;
      margin-top: 0;
      margin-bottom: 16px;
    }
    .content p {
      margin: 16px 0;
    }
    .content ul, .content ol {
      margin: 16px 0;
      padding-left: 24px;
    }
    .content li {
      margin: 8px 0;
    }
    .button {
      display: inline-block;
      background-color: #3b82f6;
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
    .alert-success {
      background-color: #f0fdf4;
      border: 2px solid #10b981;
      color: #065f46;
    }
    .date-list {
      background-color: #f8fafc;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      padding: 20px;
      margin: 20px 0;
    }
    .date-item {
      padding: 12px;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .date-item:last-child {
      border-bottom: none;
    }
    .date-label {
      font-weight: 600;
      color: #1e293b;
    }
    .date-badge {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: #ffffff;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 700;
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
        Professional Property Media, Marketing & Technology Solution<br>
        <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
      </p>
      <p style="margin-top: 20px; font-size: 12px; color: #94a3b8;">
        You received this email because you're a valued Markeb Media client.<br>
        <a href="https://markebmedia.com/dashboard">Manage your preferences</a>
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

// Replace merge tags
function replaceMergeTags(content, user) {
  return content
    .replace(/\[Name\]/g, user.name || 'there')
    .replace(/\[Company\]/g, user.company || 'your company')
    .replace(/\[Email\]/g, user.email || '');
}

// Helper: Convert time string (HH:MM) to minutes since midnight
function timeToMinutes(timeString) {
  if (!timeString) return 0;
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

// Helper: Check if a specific date has ANY available time slots
async function checkDateAvailability(region, dateString) {
  try {
    // Capitalize region for Airtable lookup
    const capitalizedRegion = region.charAt(0).toUpperCase() + region.slice(1).toLowerCase();
    
    // Fetch bookings for this date
    const bookings = await base('Bookings')
      .select({
        filterByFormula: `AND(
          {Region} = '${capitalizedRegion}',
          IS_SAME({Date}, '${dateString}', 'day'),
          OR(
            {Booking Status} = 'Booked',
            {Booking Status} = 'Reserved',
            {Booking Status} = 'Confirmed'
          )
        )`,
        fields: ['Time', 'Duration (mins)']
      })
      .all();

    // Fetch blocked times for this date
    const blockedTimes = await base('Blocked Times')
      .select({
        filterByFormula: `AND(
          {Region} = '${capitalizedRegion}',
          IS_SAME({Date}, '${dateString}', 'day')
        )`,
        fields: ['Start Time', 'End Time']
      })
      .all();

    // Generate all possible time slots (9:00 - 15:00, 30-min intervals)
    const allSlots = [];
    for (let hour = 9; hour <= 15; hour++) {
      for (let minute of [0, 30]) {
        if (hour === 15 && minute === 30) break; // Stop at 15:00
        allSlots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
      }
    }

    // Check each slot for conflicts
    const availableSlots = allSlots.filter(slotTime => {
      const slotMinutes = timeToMinutes(slotTime);
      const fixedBufferMinutes = 45;

      // Check against existing bookings (with 45-min buffer before and after)
      for (const booking of bookings) {
        const bookingStartMinutes = timeToMinutes(booking.fields.Time);
        const bookingDuration = booking.fields['Duration (mins)'] || 90;
        const bookingEndMinutes = bookingStartMinutes + bookingDuration;
        
        const bufferStartMinutes = bookingStartMinutes - fixedBufferMinutes;
        const bufferEndMinutes = bookingEndMinutes + fixedBufferMinutes;
        
        // Slot is blocked if it falls within the buffer window
        if (slotMinutes >= bufferStartMinutes && slotMinutes < bufferEndMinutes) {
          return false;
        }
      }

      // Check against admin-blocked times
      for (const blocked of blockedTimes) {
        const blockStartMinutes = timeToMinutes(blocked.fields['Start Time']);
        const blockEndMinutes = timeToMinutes(blocked.fields['End Time']);
        
        if (slotMinutes >= blockStartMinutes && slotMinutes < blockEndMinutes) {
          return false;
        }
      }

      return true;
    });

    return availableSlots.length > 0;
  } catch (error) {
    console.error('Error checking date availability:', error);
    return false;
  }
}

// Get available dates for next 30 days
async function getAvailableDates(region, mediaSpecialist) {
  try {
    const now = new Date();
    
    // Start checking from tomorrow (24-hour advance booking requirement)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 30);

    const availableDates = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate && availableDates.length < 10) {
      const dateString = currentDate.toISOString().split('T')[0];
      
      // Skip weekends (Sunday=0, Saturday=6)
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }
      
      // Check if this date has ANY available slots
      const hasAvailability = await checkDateAvailability(region, dateString);
      
      if (hasAvailability) {
        availableDates.push({
          date: dateString,
          formatted: currentDate.toLocaleDateString('en-GB', { 
            weekday: 'long', 
            day: 'numeric', 
            month: 'long', 
            year: 'numeric' 
          })
        });
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return availableDates;
  } catch (error) {
    console.error('Error getting available dates:', error);
    return [];
  }
}

// Generate availability reminder content
async function generateAvailabilityContent(user) {
  const region = user.region || 'North';
  const mediaSpecialist = region === 'South' ? 'Maeve Darley' : 'Jodie Hamshaw';
  
  const availableDates = await getAvailableDates(region, mediaSpecialist);
  
  let datesHTML = '';
  if (availableDates.length > 0) {
    datesHTML = `
      <div class="date-list">
        ${availableDates.map(d => `
          <div class="date-item">
            <span class="date-label">${d.formatted}</span>
            <span class="date-badge">AVAILABLE</span>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    datesHTML = `
      <div class="alert alert-info">
        <strong>📅 High Demand Period</strong><br>
        We're experiencing high demand! Please contact us directly to find your ideal slot.
      </div>
    `;
  }
  
  return `
    <h2>📸 Available Shoot Dates</h2>
    
    <p>Hi ${user.name},</p>
    
    <p>We wanted to let you know about upcoming availability with <strong>${mediaSpecialist}</strong> in your region (${region}).</p>
    
    <p>Here are our next available dates:</p>
    ${datesHTML}
    
    <center>
      <a href="https://markebmedia.com/book" class="button">Book Your Shoot Now</a>
    </center>
    
    <div class="alert alert-info">
      <strong>💡 Why book now?</strong><br>
      • Guaranteed priority slot<br>
      • Flexible rescheduling (24hr notice)<br>
      • Professional content within 48 hours<br>
      • Dashboard clients get exclusive perks
    </div>
    
    <p>Questions? Just reply to this email or call us directly.</p>
    
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;
}

exports.handler = async (event, context) => {
  console.log('=== Send Broadcast Email Function ===');
  
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
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
    const { recipients, subject, content, templateType, isTest, testEmail } = JSON.parse(event.body);

    console.log(`Sending ${isTest ? 'TEST' : 'BROADCAST'} email to ${recipients.length} recipients`);
    console.log(`Template type: ${templateType || 'custom'}`);

    if (!recipients || recipients.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No recipients specified' })
      };
    }

    if (!subject || !content) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Subject and content are required' })
      };
    }

    const emailsSent = [];
    const errors = [];

    // Send individual emails to each recipient
    for (const user of recipients) {
      try {
        let emailContent = content;
        
        // Generate special content for availability template
        if (templateType === 'availability') {
          emailContent = await generateAvailabilityContent(user);
        } else {
          // Replace merge tags for custom templates
          emailContent = replaceMergeTags(content, user);
        }
        
        const emailHtml = getEmailLayout(emailContent);
        
        // Determine recipient email (test or real)
        const recipientEmail = isTest ? testEmail : user.email;
        
        await resend.emails.send({
          from: FROM_EMAIL,
          to: recipientEmail,
          bcc: isTest ? [] : [BCC_EMAIL], // Only BCC on real sends
          subject: isTest ? `[TEST] ${subject}` : subject,
          html: emailHtml
        });

        emailsSent.push({
          email: recipientEmail,
          name: user.name,
          status: 'sent'
        });

        console.log(`✓ Sent to: ${user.name} (${recipientEmail})`);

      } catch (error) {
        console.error(`✗ Failed to send to ${user.email}:`, error);
        errors.push({
          email: user.email,
          name: user.name,
          error: error.message
        });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        sent: emailsSent.length,
        failed: errors.length,
        emailsSent,
        errors,
        message: isTest 
          ? `Test email sent to ${testEmail}` 
          : `Broadcast sent to ${emailsSent.length} recipients`
      })
    };

  } catch (error) {
    console.error('Error sending broadcast:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to send broadcast email',
        details: error.message 
      })
    };
  }
};