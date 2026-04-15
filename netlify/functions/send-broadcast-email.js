// netlify/functions/send-broadcast-email.js
const { Resend } = require('resend');
const Airtable = require('airtable');

const resend = new Resend(process.env.RESEND_API_KEY);
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const BCC_EMAIL = 'commercial@markebmedia.com';
const LOGO_URL = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';

// Email Layout Wrapper (matching email-service.js)
function getEmailLayout(content, userEmail = '') {
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
      margin: 16px auto 0;
      border-radius: 2px;
    }
    .content {
      padding: 40px 30px;
    }
    .content h2 {
      color: #3F4D1B;
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 16px;
    }
    .content p {
      color: #3F4D1B;
      margin: 16px 0;
    }
    .content ul,
    .content ol {
      margin: 16px 0;
      padding-left: 24px;
      color: #3F4D1B;
    }
    .content li {
      margin: 8px 0;
      color: #3F4D1B;
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
    .date-list {
      background-color: #f7ead5;
      border: 2px solid #e8d9be;
      border-radius: 12px;
      padding: 20px;
      margin: 20px 0;
    }
    .date-item {
      padding: 12px;
      border-bottom: 1px solid #e8d9be;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .date-item:last-child {
      border-bottom: none;
    }
    .date-label {
      font-weight: 600;
      color: #3F4D1B;
    }
    .date-badge {
      background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%);
      color: #FDF3E2;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 700;
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
      <p style="margin: 0 0 6px;">Professional Property Media, Marketing &amp; Technology Solution</p>
      <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
      <p style="margin-top: 20px; font-size: 12px; color: rgba(253,243,226,0.4);">
        You received this email because you're a valued Markeb Media client.<br>
        <a href="https://markebmedia.com/website/unsubscribe.html?email=${encodeURIComponent(userEmail)}" style="color: rgba(253,243,226,0.4);">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

// Replace merge tags AND convert line breaks to <br>
function replaceMergeTags(content, user) {
  const firstName = (user.name || 'there').split(' ')[0];
  const specialist = (user.region || '').toLowerCase() === 'south' ? 'Andrii' : 'James Jago';

  return content
    .replace(/\[Name\]/g, firstName)
    .replace(/\[Company\]/g, user.company || 'your company')
    .replace(/\[Email\]/g, user.email || '')
    .replace(/\[Region\]/g, user.ukRegion || user.region || 'your area')
    .replace(/\[Specialist\]/g, specialist)
    .replace(/\n/g, '<br>');
}

const REGION_TO_KEY = {
  'North': 'north',
  'South': 'south'
};

function getRegionKey(user) {
  const broadRegion = (user.region || '').toLowerCase();
  if (broadRegion === 'north') return 'north';
  if (broadRegion === 'south') return 'south';

  // Map granular UK regions to specialist region keys
  const ukRegionMap = {
    // North / James Jago
    'greater manchester': 'north-west',
    'lancashire': 'north-west',
    'merseyside': 'north-west',
    'cheshire east': 'north-west',
    'cheshire west and chester': 'north-west',
    'cumbria': 'north-west',
    'blackburn with darwen': 'north-west',
    'blackpool': 'north-west',
    'halton': 'north-west',
    'warrington': 'north-west',
    'county durham': 'north-east',
    'northumberland': 'north-east',
    'tyne and wear': 'north-east',
    'south yorkshire': 'north',
    'west yorkshire': 'north',
    'north yorkshire': 'north',
    'east riding of yorkshire': 'north',
    'york': 'north',
    'west midlands': 'west',
    'leicestershire': 'west',
    'derbyshire': 'west',
    'derby': 'west',
    'nottinghamshire': 'west',
    'nottingham': 'west',
    'staffordshire': 'west',
    'stoke-on-trent': 'west',
    'shropshire': 'west',
    'telford and wrekin': 'west',
    'herefordshire': 'west',
    'worcestershire': 'west',
    'warwickshire': 'west',
    'rutland': 'west',
    'lincolnshire': 'west',
    // Scotland → north
    'city of edinburgh': 'north',
    'glasgow city': 'north',
    'aberdeen city': 'north',
    'highland': 'north',
    'fife': 'north',
    'south lanarkshire': 'north',
    'north lanarkshire': 'north',
    'aberdeenshire': 'north',
    'dumfries and galloway': 'north',
    'scottish borders': 'north',
    'perth and kinross': 'north',
    'stirling': 'north',
    'east ayrshire': 'north',
    'north ayrshire': 'north',
    'south ayrshire': 'north',
    'renfrewshire': 'north',
    'east renfrewshire': 'north',
    'inverclyde': 'north',
    'west dunbartonshire': 'north',
    'east dunbartonshire': 'north',
    'argyll and bute': 'north',
    'falkirk': 'north',
    'clackmannanshire': 'north',
    'midlothian': 'north',
    'east lothian': 'north',
    'west lothian': 'north',
    'angus': 'north',
    'dundee city': 'north',
    'moray': 'north',
    'orkney islands': 'north',
    'shetland islands': 'north',
    'na h-eileanan siar': 'north',
    // East / Andrii
    'essex': 'east',
    'norfolk': 'east',
    'suffolk': 'east',
    'cambridgeshire': 'east',
    'peterborough': 'east',
    'hertfordshire': 'east',
    'northamptonshire': 'east',
    'bedford': 'east',
    'central bedfordshire': 'east',
    // South / Andrii
    'greater london': 'south',
    // South East
    'kent': 'south-east',
    'medway': 'south-east',
    'east sussex': 'south-east',
    'brighton and hove': 'south-east',
    'west sussex': 'south-east',
    'surrey': 'south-east',
    'hampshire': 'south-east',
    'portsmouth': 'south-east',
    'southampton': 'south-east',
    'isle of wight': 'south-east',
    'berkshire': 'south-east',
    'buckinghamshire': 'south-east',
    'oxfordshire': 'south-east',
    // South West
    'bristol': 'south-west',
    'cornwall': 'south-west',
    'devon': 'south-west',
    'plymouth': 'south-west',
    'torbay': 'south-west',
    'dorset': 'south-west',
    'bournemouth, christchurch and poole': 'south-west',
    'gloucestershire': 'south-west',
    'somerset': 'south-west',
    'bath and north east somerset': 'south-west',
    'north somerset': 'south-west',
    'south gloucestershire': 'south-west',
    'wiltshire': 'south-west',
    'swindon': 'south-west',
    // Wales
    'cardiff': 'south-west',
    'swansea': 'south-west',
    'newport': 'south-west',
    'vale of glamorgan': 'south-west',
    'rhondda cynon taf': 'south-west',
    'caerphilly': 'south-west',
    'bridgend': 'south-west',
    'neath port talbot': 'south-west',
    'carmarthenshire': 'south-west',
    'pembrokeshire': 'south-west',
    'ceredigion': 'south-west',
    'powys': 'south-west',
    'monmouthshire': 'south-west',
    'torfaen': 'south-west',
    'blaenau gwent': 'south-west',
    'merthyr tydfil': 'south-west',
    'isle of anglesey': 'north-west',
    'gwynedd': 'north-west',
    'conwy': 'north-west',
    'denbighshire': 'north-west',
    'flintshire': 'north-west',
    'wrexham': 'north-west',
    // Northern Ireland
    'belfast': 'south-east',
    'antrim and newtownabbey': 'south-east',
    'ards and north down': 'south-east',
    'armagh city, banbridge and craigavon': 'south-east',
    'causeway coast and glens': 'south-east',
    'derry city and strabane': 'south-east',
    'fermanagh and omagh': 'south-east',
    'lisburn and castlereagh': 'south-east',
    'mid and east antrim': 'south-east',
    'mid ulster': 'south-east',
    'newry, mourne and down': 'south-east'
  };

  const ukRegion = (user.ukRegion || '').toLowerCase();
  if (ukRegionMap[ukRegion]) return ukRegionMap[ukRegion];

  // Fallback based on broad region
  if (broadRegion === 'north') return 'north';
  return 'south';
}

const SPECIALIST_REGIONS = {
  'north':      'James Jago',
  'north-west': 'James Jago',
  'north-east': 'James Jago',
  'west':       'James Jago',
  'east':       'Andrii',
  'south':      'Andrii',
  'south-east': 'Andrii',
  'south-west': 'Andrii'
};

function getSpecialistForKey(regionKey) {
  return SPECIALIST_REGIONS[(regionKey || '').toLowerCase()] || 'James Jago';
}

async function fetchAvailableDatesForUser(user) {
  if (!user.ukRegion && !user.regionKey && !user.region) {
    return null;
  }
  const regionKey = getRegionKey(user);
  const baseUrl = process.env.URL || 'https://markebmedia.com';

  // Find next 7 weekdays
  const weekdays = [];
  let offset = 1;
  while (weekdays.length < 5 && offset <= 10) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      weekdays.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    offset++;
  }

  const SPECIALIST_FOR_REGION = {
    'north': 'James Jago', 'north-west': 'James Jago',
    'north-east': 'James Jago', 'west': 'James Jago',
    'east': 'Andrii', 'south': 'Andrii',
    'south-east': 'Andrii', 'south-west': 'Andrii'
  };
  const specialistName = SPECIALIST_FOR_REGION[regionKey] || 'James Jago';

  const timeToMins = (t) => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const results = await Promise.all(weekdays.map(async (dateStr) => {
    try {
      const [bookings, blockedTimes] = await Promise.all([
        base('Bookings')
          .select({
            filterByFormula: `AND(
              FIND('${specialistName}', {Media Specialist}),
              IS_SAME({Date}, '${dateStr}', 'day'),
              OR(
                {Booking Status} = 'Booked',
                {Booking Status} = 'Reserved',
                {Booking Status} = 'Confirmed'
              )
            )`,
            fields: ['Time', 'Duration (mins)']
          })
          .firstPage(),

        base('Blocked Times')
          .select({
            filterByFormula: `AND(
              FIND('${specialistName}', {Media Specialist}),
              IS_SAME({Date}, '${dateStr}', 'day')
            )`,
            fields: ['Start Time', 'End Time']
          })
          .firstPage()
      ]);

      // Generate slots 09:00 - 15:00
      const allSlots = [];
      for (let hour = 9; hour <= 15; hour++) {
        for (const minute of [0, 30]) {
          if (hour === 15 && minute === 30) break;
          allSlots.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
        }
      }

      const available = allSlots.filter(slot => {
        const slotMins = timeToMins(slot);
        const buffer = 45;
        const duration = 90;

        if (slotMins + duration > timeToMins('15:30')) return false;

        for (const b of bookings) {
          const start = timeToMins(b.fields['Time']);
          const dur = b.fields['Duration (mins)'] || 90;
          const end = start + dur;
          const twoHourBuffer = 120;
          if (slotMins >= start - twoHourBuffer && slotMins < end + twoHourBuffer) return false;
        }

        for (const bt of blockedTimes) {
          const start = timeToMins(bt.fields['Start Time']);
          const end = timeToMins(bt.fields['End Time']);
          if (slotMins >= start && slotMins < end) return false;
        }

        return true;
      });

      return available.length > 0 ? { date: dateStr, times: available } : null;
    } catch (err) {
      return null;
    }
  }));

  return results.filter(Boolean);
}

async function generateAvailabilityContent(user) {
  const availableDates = await fetchAvailableDatesForUser(user);
  if (availableDates === null) return null;
  const firstName = (user.name || 'there').split(' ')[0];

  let datesHTML = '';
  if (availableDates.length > 0) {
    datesHTML = `
      <div class="date-list">
        ${availableDates.slice(0, 5).map(({ date: dateStr, times }) => {
          const date = new Date(dateStr + 'T12:00:00');
          const formatted = date.toLocaleDateString('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long'
          });
          const timesDisplay = times.slice(0, 6).join(', ');
          return `
            <div class="date-item" style="flex-wrap: wrap; gap: 8px;">
              <span class="date-label" style="flex: 1; min-width: 0;"><strong>${formatted}</strong><br><span style="font-size:12px;color:#64748b;word-break:break-word;">${timesDisplay}</span></span>
              <span class="date-badge" style="font-size:9px; padding: 3px 8px; white-space: nowrap; align-self: flex-start;">✓</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else {
    datesHTML = `
      <div class="alert alert-warning">
        <strong>📅 High demand this week</strong><br>
        Availability opens up regularly — log in to check the latest or reply and we'll find something that works.
      </div>
    `;
  }

  return `
    <h2>📅 Availability Update</h2>

    <p>Hi ${firstName},</p>

    <p>
      We have availability on the dates below. If you're sitting with a seller and want to give them a concrete timeline, these are slots you can offer right now:
    </p>

    ${datesHTML}

    <div class="alert alert-success">
      <strong>💡 How to use this</strong><br>
      Drop these dates into your valuation conversation. Telling a vendor <em>"we can have the photographer there by Thursday"</em> is a simple but effective way to move the instruction forward.
    </div>

    <center>
      <a href="https://markebmedia.com/login" class="button">Book a Slot Now</a>
    </center>

    <p style="font-size: 14px; color: #64748b; margin-top: 20px;">
      Slots fill up quickly — if none of these work, log in to see the full calendar or reply to this email and we'll sort something.
    </p>

    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;
}

// Helper: Check if a specific date has ANY available time slots — KEEP FOR REFERENCE BUT NO LONGER CALLED
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

    // Generate email content in batches to avoid timeout
    const BATCH_SIZE = 5;
    const emailJobs = [];

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(async (user) => {
        try {
          let emailContent = content;
          if (templateType === 'availability') {
            emailContent = await generateAvailabilityContent(user);
          } else {
            emailContent = replaceMergeTags(content, user);
          }
          return { user, emailContent, error: null };
        } catch (error) {
          return { user, emailContent: null, error };
        }
      }));
      emailJobs.push(...batchResults);
    }

    await Promise.all(emailJobs.map(async ({ user, emailContent, error: contentError }) => {
      if (contentError || !emailContent) {
        errors.push({ email: user.email, name: user.name, error: contentError?.message || 'Content generation failed' });
        return;
      }
      try {
        const emailHtml = getEmailLayout(emailContent, user.email);
        const recipientEmail = isTest ? testEmail : user.email;
        await resend.emails.send({
          from: FROM_EMAIL,
          to: recipientEmail,
          bcc: isTest ? [] : [BCC_EMAIL],
          subject: isTest ? `[TEST] ${subject}` : subject,
          html: emailHtml
        });
        emailsSent.push({ email: recipientEmail, name: user.name, status: 'sent' });
        console.log(`✓ Sent to: ${user.name} (${recipientEmail})`);
      } catch (error) {
        console.error(`✗ Failed to send to ${user.email}:`, error);
        errors.push({ email: user.email, name: user.name, error: error.message });
      }
    }));

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