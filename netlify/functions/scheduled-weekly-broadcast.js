// netlify/functions/scheduled-weekly-broadcast.js
// Schedule: daily at 14:00 UTC  →  netlify.toml: schedule = "0 14 * * *"
//
// Logic:
//  1. Check if today is Monday (1) or Wednesday (3) — exit silently if not
//  2. Fetch all users where Email Notifications Enabled = true
//  3. Exclude Suspended accounts
//  4. For each user generate live availability content (same as send-broadcast-email.js)
//  5. Send via Resend using the standard Markeb layout

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

// ── Availability fetch ────────────────────────────────────────────────────────
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
async function buildEmailContent(user, dayLabel) {
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
    <h2>📅 Availability Update — ${dayLabel}</h2>

    <p>Hi ${firstName},</p>

    <p>
      Here are the nearest available shoot dates in your area. If you're sitting with a seller and want to give them a concrete timeline, these are slots you can offer right now:
    </p>

    ${datesHTML}

    <div class="alert alert-success">
      <strong>💡 How to use this</strong><br>
      Drop these dates into your next valuation conversation. Telling a vendor <em>"we can have the photographer there by Thursday"</em> is a simple but effective way to move the instruction forward.
    </div>

    <center>
      <a href="https://markebmedia.com/website/booking.html" class="button">Book a Slot Now</a>
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
        You received this because you're a valued Markeb Media client.<br>
        <a href="https://markebmedia.com/website/unsubscribe.html?email=${encodeURIComponent(userEmail)}" style="color:rgba(253,243,226,.4);">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async () => {
  const today    = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat

  // Only fire on Monday (1) or Wednesday (3)
  if (dayOfWeek !== 1 && dayOfWeek !== 3) {
    console.log(`Today is day ${dayOfWeek} — not Monday or Wednesday, skipping.`);
    return { statusCode: 200, body: JSON.stringify({ message: 'Not a broadcast day' }) };
  }

  const dayLabel = dayOfWeek === 1 ? 'Monday' : 'Wednesday';
  console.log(`=== Scheduled Weekly Broadcast (${dayLabel}) — started ===`);

  try {
    // Fetch all opted-in, non-suspended users
    const records = await base('Markeb Media Users').select({
      filterByFormula: `AND({Email Notifications Enabled},{Account Status}!='Suspended')`,
      fields: ['Name','Email','Region','Account Status']
    }).all();

    console.log(`${records.length} opted-in users to email`);
    if (records.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No opted-in users' }) };
    }

    let sent = 0, failed = 0;

    // Process in batches of 5 to avoid hammering Airtable rate limits
    const BATCH_SIZE = 5;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (record) => {
        const user = {
          name:     record.fields['Name']   || '',
          email:    record.fields['Email']  || '',
          ukRegion: record.fields['Region'] || ''
        };
        if (!user.email) return;

        try {
          const content  = await buildEmailContent(user, dayLabel);
          const htmlBody = wrapInLayout(content, user.email);

          await resend.emails.send({
            from:    FROM_EMAIL,
            to:      user.email,
            bcc:     [BCC_EMAIL],
            subject: `📅 Available Shoot Dates — ${dayLabel} Update`,
            html:    htmlBody
          });

          console.log(`✓ ${user.name} (${user.email})`);
          sent++;
        } catch (err) {
          console.error(`✗ ${user.email}: ${err.message}`);
          failed++;
        }
      }));

      // Small pause between batches to be polite to rate limits
      if (i + BATCH_SIZE < records.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`=== Done: ${sent} sent, ${failed} failed ===`);
    return { statusCode: 200, body: JSON.stringify({ success: true, sent, failed }) };

  } catch (err) {
    console.error('Fatal error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};