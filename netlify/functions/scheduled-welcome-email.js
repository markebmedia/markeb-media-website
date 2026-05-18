// netlify/functions/scheduled-welcome-email.js
// Schedule: every hour  →  netlify.toml: schedule = "0 * * * *"
//
// Logic:
//  1. Fetch users where Welcome Email Sent != true AND Email Notifications Enabled = true
//  2. Filter to those whose Created Date is within the last 24 hours
//  3. Generate live availability content (same logic as send-broadcast-email.js)
//  4. Send via Resend using the standard Markeb layout
//  5. Mark 'Welcome Email Sent' = true so it never fires twice

const Airtable = require('airtable');
const { Resend } = require('resend');

const base   = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const BCC_EMAIL  = 'commercial@markebmedia.com';
const LOGO_URL   = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';

// ── Region → specialist key (mirrors send-broadcast-email.js) ────────────────
const UK_REGION_TO_KEY = {
  'greater manchester':'north-west','lancashire':'north-west','merseyside':'north-west',
  'cheshire east':'north-west','cheshire west and chester':'north-west','cumbria':'north-west',
  'blackburn with darwen':'north-west','blackpool':'north-west','halton':'north-west','warrington':'north-west',
  'county durham':'north-east','northumberland':'north-east','tyne and wear':'north-east',
  'south yorkshire':'north','west yorkshire':'north','north yorkshire':'north',
  'east riding of yorkshire':'north','york':'north',
  'west midlands':'west','leicestershire':'west','derbyshire':'west','derby':'west',
  'nottinghamshire':'west','nottingham':'west','staffordshire':'west','stoke-on-trent':'west',
  'shropshire':'west','telford and wrekin':'west','herefordshire':'west',
  'worcestershire':'west','warwickshire':'west','rutland':'west','lincolnshire':'west',
  'city of edinburgh':'north','glasgow city':'north','aberdeen city':'north','highland':'north',
  'fife':'north','south lanarkshire':'north','north lanarkshire':'north','aberdeenshire':'north',
  'dumfries and galloway':'north','scottish borders':'north','perth and kinross':'north',
  'stirling':'north','east ayrshire':'north','north ayrshire':'north','south ayrshire':'north',
  'renfrewshire':'north','east renfrewshire':'north','inverclyde':'north',
  'west dunbartonshire':'north','east dunbartonshire':'north','argyll and bute':'north',
  'falkirk':'north','clackmannanshire':'north','midlothian':'north','east lothian':'north',
  'west lothian':'north','angus':'north','dundee city':'north','moray':'north',
  'orkney islands':'north','shetland islands':'north','na h-eileanan siar':'north',
  'essex':'east','norfolk':'east','suffolk':'east','cambridgeshire':'east','peterborough':'east',
  'hertfordshire':'east','northamptonshire':'east','bedford':'east','central bedfordshire':'east',
  'greater london':'south',
  'kent':'south-east','medway':'south-east','east sussex':'south-east','brighton and hove':'south-east',
  'west sussex':'south-east','surrey':'south-east','hampshire':'south-east','portsmouth':'south-east',
  'southampton':'south-east','isle of wight':'south-east','berkshire':'south-east',
  'buckinghamshire':'south-east','oxfordshire':'south-east',
  'bristol':'south-west','cornwall':'south-west','devon':'south-west','plymouth':'south-west',
  'torbay':'south-west','dorset':'south-west','bournemouth, christchurch and poole':'south-west',
  'gloucestershire':'south-west','somerset':'south-west',
  'bath and north east somerset':'south-west','north somerset':'south-west',
  'south gloucestershire':'south-west','wiltshire':'south-west','swindon':'south-west',
  'cardiff':'south-west','swansea':'south-west','newport':'south-west',
  'vale of glamorgan':'south-west','rhondda cynon taf':'south-west','caerphilly':'south-west',
  'bridgend':'south-west','neath port talbot':'south-west','carmarthenshire':'south-west',
  'pembrokeshire':'south-west','ceredigion':'south-west','powys':'south-west',
  'monmouthshire':'south-west','torfaen':'south-west','blaenau gwent':'south-west',
  'merthyr tydfil':'south-west','isle of anglesey':'north-west','gwynedd':'north-west',
  'conwy':'north-west','denbighshire':'north-west','flintshire':'north-west','wrexham':'north-west',
  'belfast':'south-east','antrim and newtownabbey':'south-east','ards and north down':'south-east',
  'armagh city, banbridge and craigavon':'south-east','causeway coast and glens':'south-east',
  'derry city and strabane':'south-east','fermanagh and omagh':'south-east',
  'lisburn and castlereagh':'south-east','mid and east antrim':'south-east',
  'mid ulster':'south-east','newry, mourne and down':'south-east'
};

const SPECIALIST_FOR_KEY = {
  'north':'James Jago','north-west':'James Jago','north-east':'James Jago','west':'James Jago',
  'east':'Andrii','south':'Andrii','south-east':'Andrii','south-west':'Andrii'
};

function getRegionKey(ukRegion) {
  return UK_REGION_TO_KEY[(ukRegion || '').toLowerCase()] || 'south';
}

// ── Availability fetch (identical to send-broadcast-email.js) ────────────────
function timeToMins(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

async function fetchAvailableDates(ukRegion) {
  const regionKey      = getRegionKey(ukRegion);
  const specialistName = SPECIALIST_FOR_KEY[regionKey] || 'Andrii';

  const weekdays = [];
  let offset = 1;
  while (weekdays.length < 5 && offset <= 10) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      weekdays.push(
        `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      );
    }
    offset++;
  }

  const results = await Promise.all(weekdays.map(async (dateStr) => {
    try {
      const [bookings, blockedTimes] = await Promise.all([
        base('Bookings').select({
          filterByFormula: `AND(
            FIND('${specialistName}',{Media Specialist}),
            IS_SAME({Date},'${dateStr}','day'),
            OR({Booking Status}='Booked',{Booking Status}='Reserved',{Booking Status}='Confirmed')
          )`,
          fields: ['Time','Duration (mins)']
        }).firstPage(),
        base('Blocked Times').select({
          filterByFormula: `AND(
            FIND('${specialistName}',{Media Specialist}),
            IS_SAME({Date},'${dateStr}','day')
          )`,
          fields: ['Start Time','End Time']
        }).firstPage()
      ]);

      const allSlots = [];
      for (let h = 9; h <= 15; h++) {
        for (const min of [0, 30]) {
          if (h === 15 && min === 30) break;
          allSlots.push(`${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`);
        }
      }

      const available = allSlots.filter(slot => {
        const sm = timeToMins(slot);
        if (sm + 90 > timeToMins('15:30')) return false;
        for (const b of bookings) {
          const start = timeToMins(b.fields['Time']);
          const dur   = b.fields['Duration (mins)'] || 90;
          if (sm >= start - 120 && sm < start + dur + 120) return false;
        }
        for (const bt of blockedTimes) {
          const start = timeToMins(bt.fields['Start Time']);
          const end   = timeToMins(bt.fields['End Time']);
          if (sm >= start && sm < end) return false;
        }
        return true;
      });

      return available.length > 0 ? { date: dateStr, times: available } : null;
    } catch {
      return null;
    }
  }));

  return results.filter(Boolean);
}

// ── Email content ─────────────────────────────────────────────────────────────
async function buildEmailContent(user) {
  const availableDates = await fetchAvailableDates(user.ukRegion);
  const firstName      = (user.name || 'there').split(' ')[0];

  let datesHTML;
  if (availableDates.length > 0) {
    datesHTML = `
      <div class="date-list">
        ${availableDates.slice(0, 5).map(({ date: dateStr, times }) => {
          const date      = new Date(dateStr + 'T12:00:00');
          const formatted = date.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });
          const timesDisplay = times.slice(0, 6).join(', ');
          return `
            <div class="date-item" style="flex-wrap:wrap;gap:8px;">
              <span class="date-label" style="flex:1;min-width:0;">
                <strong>${formatted}</strong><br>
                <span style="font-size:12px;color:#64748b;word-break:break-word;">${timesDisplay}</span>
              </span>
              <span class="date-badge" style="font-size:9px;padding:3px 8px;white-space:nowrap;align-self:flex-start;">✓</span>
            </div>`;
        }).join('')}
      </div>`;
  } else {
    datesHTML = `
      <div class="alert alert-warning">
        <strong>📅 High demand this week</strong><br>
        Availability opens up regularly — log in to check the latest or reply and we'll find something that works.
      </div>`;
  }

  return `
    <h2>📅 Welcome to Markeb Media — here's what's available near you</h2>

    <p>Hi ${firstName},</p>

    <p>Your dashboard is now live. Here are the nearest available shoot dates in your area so you can get your first booking in straight away:</p>

    ${datesHTML}

    <div class="alert alert-success">
      <strong>💡 How to use this</strong><br>
      Drop these dates into your next valuation. Telling a vendor <em>"we can have the photographer there by Thursday"</em> is a simple but effective way to move the instruction forward.
    </div>

    <center>
      <a href="https://markebmedia.com/website/booking.html" class="button">Book Your First Shoot</a>
    </center>

    <p style="font-size:14px;color:#64748b;margin-top:20px;">
      Slots fill up quickly — if none of these work, log in to see the full calendar or reply to this email and we'll sort something.
    </p>

    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>`;
}

function wrapInLayout(content, userEmail) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Markeb Media</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.6;color:#3F4D1B;background-color:#f7ead5;margin:0;padding:0}
    .container{max-width:600px;margin:0 auto;background-color:#FDF3E2}
    .header{background:linear-gradient(135deg,#3F4D1B 0%,#2d3813 100%);padding:40px 20px;text-align:center}
    .header img{max-width:200px;width:100%;height:auto;margin-bottom:20px}
    .header h1{color:#FDF3E2;margin:0;font-size:28px;font-weight:700;letter-spacing:-.02em}
    .header-accent{width:40px;height:3px;background:#B46100;margin:16px auto 0;border-radius:2px}
    .content{padding:40px 30px}
    .content h2{color:#3F4D1B;font-size:22px;font-weight:700;margin:0 0 16px}
    .content p{color:#3F4D1B;margin:16px 0}
    .button{display:inline-block;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);color:#FDF3E2!important;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;margin:20px 0;font-size:15px;letter-spacing:.01em}
    .alert{padding:16px;border-radius:8px;margin:20px 0;font-size:14px}
    .alert-warning{background-color:#fef9ec;border:2px solid #cc7a1a;color:#7a3e00}
    .alert-success{background-color:#f3f7e8;border:2px solid #3F4D1B;color:#3F4D1B}
    .date-list{background-color:#f7ead5;border:2px solid #e8d9be;border-radius:12px;padding:20px;margin:20px 0}
    .date-item{padding:12px;border-bottom:1px solid #e8d9be;display:flex;justify-content:space-between;align-items:center}
    .date-item:last-child{border-bottom:none}
    .date-label{font-weight:600;color:#3F4D1B}
    .date-badge{background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);color:#FDF3E2;padding:4px 12px;border-radius:12px;font-size:11px;font-weight:700}
    .footer{background-color:#3F4D1B;padding:30px;text-align:center;color:rgba(253,243,226,.7);font-size:14px}
    .footer strong{color:#FDF3E2}
    .footer a{color:#B46100;text-decoration:none}
    .footer-divider{width:32px;height:2px;background:#B46100;margin:16px auto;border-radius:1px}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Markeb Media">
      <h1>Markeb Media</h1>
      <div class="header-accent"></div>
    </div>
    <div class="content">${content}</div>
    <div class="footer">
      <strong>Markeb Media</strong>
      <div class="footer-divider"></div>
      <p style="margin:0 0 6px;">Professional Property Media, Marketing &amp; Technology Solution</p>
      <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
      <p style="margin-top:20px;font-size:12px;color:rgba(253,243,226,.4);">
        You received this because you registered at markebmedia.com.<br>
        <a href="https://markebmedia.com/website/unsubscribe.html?email=${encodeURIComponent(userEmail)}" style="color:rgba(253,243,226,.4);">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async () => {
  console.log('=== Scheduled Welcome Email — started ===');

  try {
    const now       = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Fetch users who haven't had their welcome email yet and have notifications on
    const records = await base('Markeb Media Users').select({
      filterByFormula: `AND(NOT({Welcome Email Sent}),{Email Notifications Enabled})`,
      fields: ['Name','Email','Region','Created Date','Account Status']
    }).all();

    // Keep only those who signed up in the last 24 hours and aren't suspended
    const newUsers = records.filter(r => {
      const createdAt = new Date(r.fields['Created Date']);
      return createdAt >= cutoff24h
          && createdAt <= now
          && r.fields['Account Status'] !== 'Suspended';
    });

    console.log(`${newUsers.length} new users to welcome`);
    if (newUsers.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No new users' }) };
    }

    let sent = 0, failed = 0;

    for (const record of newUsers) {
      const user = {
        name:      record.fields['Name']   || '',
        email:     record.fields['Email']  || '',
        ukRegion:  record.fields['Region'] || ''
      };
      if (!user.email) continue;

      try {
        const content  = await buildEmailContent(user);
        const htmlBody = wrapInLayout(content, user.email);

        await resend.emails.send({
          from:    FROM_EMAIL,
          to:      user.email,
          bcc:     [BCC_EMAIL],
          subject: 'Welcome to Markeb Media — here\'s what\'s available near you',
          html:    htmlBody
        });

        // Prevent re-sending
        await base('Markeb Media Users').update(record.id, { 'Welcome Email Sent': true });

        console.log(`✓ Sent to ${user.name} (${user.email})`);
        sent++;
      } catch (err) {
        console.error(`✗ Failed for ${user.email}:`, err.message);
        failed++;
      }
    }

    console.log(`=== Done: ${sent} sent, ${failed} failed ===`);
    return { statusCode: 200, body: JSON.stringify({ success: true, sent, failed }) };

  } catch (err) {
    console.error('Fatal error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};