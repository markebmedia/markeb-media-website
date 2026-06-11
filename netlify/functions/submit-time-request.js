const Airtable = require('airtable');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

function generateRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'TR-';
  for (let i = 0; i < 6; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const {
      requestedDate, requestedTime, clientName, clientPhone, clientEmail,
      notes, postcode, region, mediaSpecialist, service, serviceId
    } = body;

    const requestRef = generateRef();

    // Save to Airtable
    await base('Time Requests').create([{
      fields: {
        'Request Ref':      requestRef,
        'Client Name':      clientName,
        'Client Email':     clientEmail,
        'Client Phone':     clientPhone,
        'Postcode':         postcode || '',
        'Region':           region || '',
        'Media Specialist': mediaSpecialist || '',
        'Requested Date':   requestedDate,
        'Requested Time':   requestedTime,
        'Service':          service || '',
        'Notes':            notes || '',
        'Status':           'Pending',
        'Created At':       new Date().toISOString()
      }
    }]);

    // Format date for email
    const dateObj = new Date(requestedDate + 'T12:00:00');
    const formattedDate = dateObj.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    // Internal notification email
    await resend.emails.send({
      from: 'Markeb Media <commercial@markebmedia.com>',
      to: 'commercial@markebmedia.com',
      subject: `[TIME REQUEST] ${requestRef} — ${clientName} — ${formattedDate} at ${requestedTime}`,
      html: `
        <!DOCTYPE html><html><head><meta charset="utf-8"></head>
        <body style="font-family: -apple-system, sans-serif; background: #f7ead5; margin:0; padding:20px;">
        <div style="max-width:600px; margin:0 auto; background:#FDF3E2; border-radius:12px; overflow:hidden;">
          <div style="background: linear-gradient(135deg, #3F4D1B, #2d3813); padding:32px; text-align:center;">
            <h1 style="color:#FDF3E2; margin:0; font-size:22px;">New Time Request</h1>
            <div style="width:32px; height:3px; background:#B46100; margin:12px auto 0; border-radius:2px;"></div>
          </div>
          <div style="padding:32px;">
            <div style="background:#fff8ee; border:2px solid #B46100; border-radius:10px; padding:16px; margin-bottom:24px;">
              <strong style="color:#8a4a00;">Ref: ${requestRef}</strong>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:14px;">
              <tr style="border-bottom:1px solid #e8d9be;"><td style="padding:12px 0; color:#6b7c2e; font-weight:600; width:40%;">Client</td><td style="padding:12px 0; color:#1e293b; font-weight:600;">${clientName}</td></tr>
              <tr style="border-bottom:1px solid #e8d9be;"><td style="padding:12px 0; color:#6b7c2e; font-weight:600;">Email</td><td style="padding:12px 0; color:#1e293b; font-weight:600;">${clientEmail}</td></tr>
              <tr style="border-bottom:1px solid #e8d9be;"><td style="padding:12px 0; color:#6b7c2e; font-weight:600;">Phone</td><td style="padding:12px 0; color:#1e293b; font-weight:600;">${clientPhone}</td></tr>
              <tr style="border-bottom:1px solid #e8d9be;"><td style="padding:12px 0; color:#6b7c2e; font-weight:600;">Requested Date</td><td style="padding:12px 0; color:#1e293b; font-weight:600;">${formattedDate}</td></tr>
              <tr style="border-bottom:1px solid #e8d9be;"><td style="padding:12px 0; color:#6b7c2e; font-weight:600;">Requested Time</td><td style="padding:12px 0; color:#1e293b; font-weight:600;">${requestedTime}</td></tr>
              <tr style="border-bottom:1px solid #e8d9be;"><td style="padding:12px 0; color:#6b7c2e; font-weight:600;">Service</td><td style="padding:12px 0; color:#1e293b; font-weight:600;">${service || '—'}</td></tr>
              <tr style="border-bottom:1px solid #e8d9be;"><td style="padding:12px 0; color:#6b7c2e; font-weight:600;">Postcode</td><td style="padding:12px 0; color:#1e293b; font-weight:600;">${postcode || '—'}</td></tr>
              <tr style="border-bottom:1px solid #e8d9be;"><td style="padding:12px 0; color:#6b7c2e; font-weight:600;">Specialist</td><td style="padding:12px 0; color:#1e293b; font-weight:600;">${mediaSpecialist || '—'}</td></tr>
              ${notes ? `<tr><td style="padding:12px 0; color:#6b7c2e; font-weight:600; vertical-align:top;">Notes</td><td style="padding:12px 0; color:#1e293b;">${notes}</td></tr>` : ''}
            </table>
            <div style="margin-top:24px; text-align:center;">
              <a href="https://markebmedia.com/website/admin-panel.html#time-requests" 
                 style="display:inline-block; background:linear-gradient(135deg,#B46100,#8a4a00); color:#FDF3E2; padding:14px 32px; border-radius:10px; text-decoration:none; font-weight:700; font-size:15px;">
                Review in Admin Panel
              </a>
            </div>
          </div>
        </div>
        </body></html>
      `
    });

    // Client acknowledgement email
    await resend.emails.send({
      from: 'Markeb Media <commercial@markebmedia.com>',
      to: clientEmail,
      subject: `Time Request Received — ${requestRef}`,
      html: `
        <!DOCTYPE html><html><head><meta charset="utf-8"></head>
        <body style="font-family: -apple-system, sans-serif; background: #f7ead5; margin:0; padding:20px;">
        <div style="max-width:600px; margin:0 auto; background:#FDF3E2; border-radius:12px; overflow:hidden;">
          <div style="background: linear-gradient(135deg, #3F4D1B, #2d3813); padding:32px; text-align:center;">
            <h1 style="color:#FDF3E2; margin:0; font-size:22px;">Request Received</h1>
            <div style="width:32px; height:3px; background:#B46100; margin:12px auto 0; border-radius:2px;"></div>
          </div>
          <div style="padding:32px;">
            <p style="color:#3F4D1B; margin:0 0 16px;">Hi ${clientName},</p>
            <p style="color:#3F4D1B; margin:0 0 24px;">We've received your time request and will get back to you within <strong>24 hours</strong> to confirm whether we can accommodate you.</p>
            <div style="background:#f8fafc; border:2px solid #e2e8f0; border-radius:10px; padding:20px; margin-bottom:24px;">
              <table style="width:100%; border-collapse:collapse; font-size:14px;">
                <tr style="border-bottom:1px solid #e8d9be;"><td style="padding:10px 0; color:#6b7c2e; font-weight:600; width:45%;">Reference</td><td style="padding:10px 0; color:#1e293b; font-weight:700;">${requestRef}</td></tr>
                <tr style="border-bottom:1px solid #e8d9be;"><td style="padding:10px 0; color:#6b7c2e; font-weight:600;">Requested Date</td><td style="padding:10px 0; color:#1e293b; font-weight:600;">${formattedDate}</td></tr>
                <tr style="border-bottom:1px solid #e8d9be;"><td style="padding:10px 0; color:#6b7c2e; font-weight:600;">Requested Time</td><td style="padding:10px 0; color:#1e293b; font-weight:600;">${requestedTime}</td></tr>
                ${service ? `<tr><td style="padding:10px 0; color:#6b7c2e; font-weight:600;">Service</td><td style="padding:10px 0; color:#1e293b; font-weight:600;">${service}</td></tr>` : ''}
              </table>
            </div>
            <div style="background:#fff8ee; border:2px solid #B46100; border-radius:10px; padding:16px; font-size:13px; color:#8a4a00; margin-bottom:24px;">
              <strong>What happens next?</strong><br><br>
              If we can accommodate your requested time, we'll book it in and send you a full booking confirmation.<br><br>
              If we're unable to accommodate it, we'll reply with the nearest available alternative dates so you can choose what works best.
            </div>
            <p style="color:#3F4D1B; margin:0 0 6px;">In the meantime, if you need to get in touch:</p>
            <p style="color:#3F4D1B; margin:0;"><a href="mailto:commercial@markebmedia.com" style="color:#B46100; font-weight:600;">commercial@markebmedia.com</a></p>
          </div>
          <div style="background:#3F4D1B; padding:24px; text-align:center; color:rgba(253,243,226,0.7); font-size:13px;">
            <strong style="color:#FDF3E2;">Markeb Media</strong>
            <div style="width:24px; height:2px; background:#B46100; margin:10px auto;"></div>
            Professional Property Media &amp; Marketing
          </div>
        </div>
        </body></html>
      `
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, requestRef })
    };

  } catch (error) {
    console.error('Time request error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};