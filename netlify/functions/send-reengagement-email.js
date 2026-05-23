// netlify/functions/send-reengagement-email.js
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL  = 'Markeb Media <commercial@markebmedia.com>';
const BCC_EMAIL   = 'commercial@markebmedia.com';
const LOGO_URL    = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';
const SITE_URL    = 'https://markebmedia.com';
const DASH_URL    = `${SITE_URL}/website/dashboard.html`;
const BOOK_URL    = `${SITE_URL}/website/booking.html`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { email, name, company, region } = JSON.parse(event.body || '{}');

  if (!email || !name) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'email and name are required' })
    };
  }

  const firstName   = name.split(' ')[0];
  const regionLabel = region || 'your area';

  const html = buildEmail(firstName, regionLabel);

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to:   email,
      bcc:  BCC_EMAIL,
      subject: `${firstName}, your dashboard has been busy while you were away 👀`,
      html
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    console.error('Re-engagement email error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};

function buildEmail(firstName, regionLabel) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Markeb Media dashboard</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    body, table, td, p, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table { border-collapse:collapse !important; }
    body  { margin:0 !important; padding:0 !important; background-color:#f7ead5; }
    img   { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
    @media only screen and (max-width:600px) {
      .email-container { width:100% !important; }
      .fluid { width:100% !important; max-width:100% !important; }
      .stack-col { display:block !important; width:100% !important; }
      .pad-mobile { padding:24px 20px !important; }
      .hide-mobile { display:none !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f7ead5;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
  style="background-color:#f7ead5;">
  <tr>
    <td align="center" style="padding:24px 12px;">

      <table class="email-container" role="presentation" width="600" cellpadding="0"
        cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FDF3E2;">

        <!-- HEADER -->
        <tr>
          <td align="center"
            style="background:linear-gradient(135deg,#3F4D1B 0%,#2d3813 100%);padding:36px 30px 28px;">
            <img src="${LOGO_URL}" alt="Markeb Media"
              style="max-width:150px;width:100%;height:auto;display:block;margin:0 auto 14px;">
            <p style="margin:0;color:rgba(253,243,226,0.7);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;">
              Client Dashboard Update
            </p>
            <div style="width:36px;height:3px;background:#B46100;margin:12px auto 0;border-radius:2px;"></div>
          </td>
        </tr>

        <!-- HERO -->
        <tr>
          <td style="background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);padding:44px 36px 40px;">
            <h1 style="margin:0 0 12px;color:#FDF3E2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:30px;font-weight:800;line-height:1.2;letter-spacing:-0.02em;">
              A lot's happened since<br>you last logged in, ${firstName}.
            </h1>
            <p style="margin:0;color:rgba(253,243,226,0.88);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:1.6;">
             Agents in your network are already using their dashboard every week. They're tracking shoots, building brochures and getting content out faster than ever. Here's everything that's been waiting for you.
            </p>
          </td>
        </tr>

        <!-- INTRO -->
        <tr>
          <td class="pad-mobile" style="padding:36px 36px 0;">
            <p style="margin:0 0 14px;color:#3F4D1B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.7;">
              Hi ${firstName},
            </p>
            <p style="margin:0 0 14px;color:#3F4D1B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.7;">
              Agents in your area are logging in every week to track shoots, request amendments and download content. Everything they need is in one place.
            </p>
            <p style="margin:0;color:#3F4D1B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.7;">
              Here's a quick rundown of what's available to you right now, and how other agents in <strong>${regionLabel}</strong> are using each feature in their day-to-day.
            </p>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr>
          <td style="padding:28px 36px 0;">
            <div style="height:3px;background:linear-gradient(90deg,#B46100 0%,rgba(180,97,0,0.15) 100%);border-radius:2px;"></div>
          </td>
        </tr>

        <!-- FEATURE 1 -->
        <tr>
          <td class="pad-mobile" style="padding:28px 36px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="top" width="52">
                  <div style="width:44px;height:44px;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);border-radius:12px;text-align:center;line-height:44px;font-size:22px;">
                    📦
                  </div>
                </td>
                <td valign="top" style="padding-left:14px;">
                  <h2 style="margin:0 0 6px;color:#B46100;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:17px;font-weight:800;letter-spacing:-0.01em;">
                    Content Tracking: Know exactly where your shoot is
                  </h2>
                  <p style="margin:0;color:#3F4D1B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;">
                    Every booking has a live tracking code. From the moment your specialist arrives on site through to editing, QC and final delivery you can see exactly what stage each property is at without calling or emailing us. Agents told us this alone saves them 20 to 30 minutes a week.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FEATURE 2 -->
        <tr>
          <td class="pad-mobile" style="padding:22px 36px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="top" width="52">
                  <div style="width:44px;height:44px;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);border-radius:12px;text-align:center;line-height:44px;font-size:22px;">
                    ✏️
                  </div>
                </td>
                <td valign="top" style="padding-left:14px;">
                  <h2 style="margin:0 0 6px;color:#B46100;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:17px;font-weight:800;letter-spacing:-0.01em;">
                    Amendment Requests: No more back and forth emails
                  </h2>
                  <p style="margin:0;color:#3F4D1B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;">
                    Need a re-edit, a different crop, or a colour correction? Submit it directly from your dashboard in seconds. The request goes straight to your media specialist with all the context attached. No email threads, no missed messages, no delays.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FEATURE 3 -->
        <tr>
          <td class="pad-mobile" style="padding:22px 36px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="top" width="52">
                  <div style="width:44px;height:44px;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);border-radius:12px;text-align:center;line-height:44px;font-size:22px;">
                    📄
                  </div>
                </td>
                <td valign="top" style="padding-left:14px;">
                  <h2 style="margin:0 0 6px;color:#B46100;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:17px;font-weight:800;letter-spacing:-0.01em;">
                    Property Brochure Builder: Professional PDFs in minutes
                  </h2>
                  <p style="margin:0;color:#3F4D1B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;">
                    Once your photos are delivered, you can build a fully branded property brochure straight from your dashboard in PDF or Word format. Pull in your images, add descriptions, done. No designer needed. Exclusive to dashboard members.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FEATURE 4 -->
        <tr>
          <td class="pad-mobile" style="padding:22px 36px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="top" width="52">
                  <div style="width:44px;height:44px;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);border-radius:12px;text-align:center;line-height:44px;font-size:22px;">
                    🤖
                  </div>
                </td>
                <td valign="top" style="padding-left:14px;">
                  <h2 style="margin:0 0 6px;color:#B46100;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:17px;font-weight:800;letter-spacing:-0.01em;">
                    CopyRyta AI: Property descriptions in seconds
                  </h2>
                  <p style="margin:0;color:#3F4D1B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;">
                    Generate polished property descriptions and social media captions directly from your dashboard. Just fill in a few details and CopyRyta writes the copy for you. Rightmove ready and on brand. Agents are using this before every listing goes live.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FEATURE 5 -->
        <tr>
          <td class="pad-mobile" style="padding:22px 36px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="top" width="52">
                  <div style="width:44px;height:44px;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);border-radius:12px;text-align:center;line-height:44px;font-size:22px;">
                    📅
                  </div>
                </td>
                <td valign="top" style="padding-left:14px;">
                  <h2 style="margin:0 0 6px;color:#B46100;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:17px;font-weight:800;letter-spacing:-0.01em;">
                    Social Media Content Calendar: See what's going out
                  </h2>
                  <p style="margin:0;color:#3F4D1B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;">
                    Your content calendar shows every scheduled post before it goes live so you're never caught off guard, and you can approve or flag anything before it publishes. Full visibility, full control, all in one place.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- DIVIDER -->
        <tr>
          <td style="padding:28px 36px 0;">
            <div style="height:3px;background:linear-gradient(90deg,#B46100 0%,rgba(180,97,0,0.15) 100%);border-radius:2px;"></div>
          </td>
        </tr>

        <!-- NETWORK BLOCK -->
        <tr>
          <td class="pad-mobile" style="padding:28px 36px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:linear-gradient(135deg,#3F4D1B 0%,#2d3813 100%);border-radius:14px;padding:28px 28px 24px;">
                  <h2 style="margin:0 0 10px;color:#FDF3E2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:19px;font-weight:800;letter-spacing:-0.01em;">
                    📍 We're growing in ${regionLabel}
                  </h2>
                  <p style="margin:0 0 14px;color:rgba(253,243,226,0.88);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;">
                    More agents in your region are joining Markeb Media every week. That means your media specialist knows the roads, the light conditions, and the property types in your patch better than anyone. Local knowledge, professional output, every time.
                  </p>
                  <p style="margin:0;color:rgba(253,243,226,0.88);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;">
                    As the network grows, so does the value of being a dashboard member. Exclusive pricing, priority availability, and a direct line to your specialist. That's something you won't get booking ad hoc.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td class="pad-mobile" style="padding:32px 36px 0;text-align:center;">
            <p style="margin:0 0 20px;color:#3F4D1B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.7;">
              Log back in and take two minutes to explore what's new. Your specialist is ready whenever you are.
            </p>
            <a href="${DASH_URL}"
              style="display:inline-block;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);color:#FDF3E2;text-decoration:none;padding:15px 38px;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-weight:800;font-size:15px;letter-spacing:0.01em;margin-bottom:12px;">
              Log in to my dashboard →
            </a>
            <br>
            <a href="${BOOK_URL}"
              style="display:inline-block;color:#B46100;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-weight:700;font-size:13px;border-bottom:2px solid #B46100;padding-bottom:2px;">
              Or book a shoot directly
            </a>
          </td>
        </tr>

        <!-- SIGN OFF -->
        <tr>
          <td class="pad-mobile" style="padding:28px 36px 36px;">
            <p style="margin:0 0 10px;color:#6b5c3e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;">
              Got a question or want to talk through your content strategy? Just reply to this email and we get back to every message same day.
            </p>
            <p style="margin:0;color:#3F4D1B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:700;">
              The Markeb Media Team
            </p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#3F4D1B;padding:28px 36px;text-align:center;">
            <div style="width:32px;height:2px;background:#B46100;margin:0 auto 16px;border-radius:1px;"></div>
            <p style="margin:0 0 4px;color:rgba(253,243,226,0.9);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:700;">
              Markeb Media Ltd
            </p>
            <p style="margin:0 0 4px;color:rgba(253,243,226,0.55);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12px;">
              Pennine Five, 20 to 22 Hawley Street, Sheffield S1 2EA
            </p>
            <p style="margin:0 0 16px;">
              <a href="mailto:commercial@markebmedia.com"
                style="color:#B46100;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12px;">
                commercial@markebmedia.com
              </a>
            </p>
            <p style="margin:0;color:rgba(253,243,226,0.25);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:11px;">
              You're receiving this because you have an account at markebmedia.com
            </p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>

</body>
</html>`;
}