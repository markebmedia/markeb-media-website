// netlify/functions/notify-client-review.js
//
// Sends a branded email to the client letting them know their
// raw content is ready to review in the portal.
//
// Call this manually via the Airtable automation webhook,
// or trigger it from your admin panel after creating the review record.
//
// POST body:
// {
//   clientEmail:    "client@example.com",
//   clientName:     "Sarah Johnson",       // optional, falls back to "there"
//   projectAddress: "12 Oak Street, Manchester",
//   shootDate:      "2026-03-22",          // optional
//   serviceType:    "Photography + Drone", // optional
//   hasPhotos:      true,                  // optional
//   hasVideo:       true,                  // optional
//   portalUrl:      "https://portal.markebmedia.com/website/dashboard.html" // optional override
// }

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = process.env.RESEND_FROM_EMAIL  || 'notifications@markebmedia.com';
const PORTAL_URL     = process.env.PORTAL_URL          || 'https://portal.markebmedia.com/website/dashboard.html';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const {
      clientEmail,
      clientName,
      projectAddress,
      shootDate,
      serviceType,
      hasPhotos,
      hasVideo,
      portalUrl,
    } = JSON.parse(event.body || '{}');

    if (!clientEmail || !projectAddress) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'clientEmail and projectAddress are required' }),
      };
    }

    const firstName   = clientName ? clientName.split(' ')[0] : 'there';
    const portalLink  = portalUrl || PORTAL_URL;

    // Format shoot date nicely if provided
    let shootDateFormatted = null;
    if (shootDate) {
      const d = new Date(shootDate);
      if (!Number.isNaN(d.getTime())) {
        shootDateFormatted = d.toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
      }
    }

    // Media type badges
    const mediaBadges = [
      hasPhotos !== false && `<span style="background:#dbeafe;color:#1e40af;padding:4px 12px;border-radius:12px;font-size:13px;font-weight:700;margin-right:6px;">📷 Photos</span>`,
      hasVideo  !== false && `<span style="background:#ede9fe;color:#5b21b6;padding:4px 12px;border-radius:12px;font-size:13px;font-weight:700;">🎬 Video</span>`,
    ].filter(Boolean).join('');

    const emailHTML = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>Your content is ready to review</title>
      </head>
      <body style="margin:0;padding:0;background:#f8fafc;font-family:'Inter',Arial,sans-serif;">

        <div style="max-width:600px;margin:0 auto;padding:32px 16px;">

          <!-- Header -->
          <div style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);border-radius:16px 16px 0 0;padding:32px;text-align:center;">
            <div style="font-size:36px;margin-bottom:8px;">📷</div>
            <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;line-height:1.3;">
              Your content is ready to review
            </h1>
            <p style="margin:10px 0 0;color:rgba(255,255,255,0.9);font-size:15px;">
              Log in to your portal to view and approve your files
            </p>
          </div>

          <!-- Body -->
          <div style="background:#fff;padding:32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">

            <p style="color:#1e293b;font-size:16px;margin:0 0 24px;">
              Hi ${firstName},
            </p>

            <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 24px;">
              Your raw ${serviceType ? `<strong>${serviceType}</strong>` : 'content'} files are now available in your Markeb Media portal. We'd love your feedback before we send everything to our editing team.
            </p>

            <!-- Project details card -->
            <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:28px;">
              <table style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="padding:8px 0;color:#64748b;font-size:13px;width:130px;vertical-align:top;">Property</td>
                  <td style="padding:8px 0;color:#1e293b;font-weight:700;font-size:14px;">${projectAddress}</td>
                </tr>
                ${shootDateFormatted ? `
                <tr>
                  <td style="padding:8px 0;color:#64748b;font-size:13px;vertical-align:top;">Shoot Date</td>
                  <td style="padding:8px 0;color:#1e293b;font-size:14px;">${shootDateFormatted}</td>
                </tr>` : ''}
                ${serviceType ? `
                <tr>
                  <td style="padding:8px 0;color:#64748b;font-size:13px;vertical-align:top;">Service</td>
                  <td style="padding:8px 0;color:#1e293b;font-size:14px;">${serviceType}</td>
                </tr>` : ''}
                ${mediaBadges ? `
                <tr>
                  <td style="padding:8px 0;color:#64748b;font-size:13px;vertical-align:top;">Files ready</td>
                  <td style="padding:12px 0 8px;">${mediaBadges}</td>
                </tr>` : ''}
              </table>
            </div>

            <!-- How it works -->
            <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1.5px solid #bfdbfe;border-radius:12px;padding:20px;margin-bottom:28px;">
              <p style="margin:0 0 12px;color:#1e40af;font-weight:700;font-size:14px;">📋 How to review your content</p>
              <ol style="margin:0;padding-left:20px;color:#1e40af;font-size:13px;line-height:1.8;">
                <li>Click the button below to log in to your portal</li>
                <li>Go to the <strong>Gallery</strong> tab in the sidebar</li>
                <li>Open your Dropbox folder(s) to view the raw files</li>
                <li>Leave any feedback in the notes boxes — photos and video separately</li>
                <li>Click <strong>Approve &amp; Notify Team</strong> when you're happy</li>
              </ol>
            </div>

            <!-- CTA button -->
            <div style="text-align:center;margin-bottom:28px;">
              <a
                href="${portalLink}"
                style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;text-decoration:none;padding:16px 40px;border-radius:10px;font-size:16px;font-weight:700;box-shadow:0 4px 14px rgba(59,130,246,0.35);"
              >
                Review My Content →
              </a>
            </div>

            <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;">
              Once you've approved your content, our editing team will get started straight away. If you have any questions, reply to this email or contact us at
              <a href="mailto:commercial@markebmedia.com" style="color:#3b82f6;">commercial@markebmedia.com</a>.
            </p>

          </div>

          <!-- Footer -->
          <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
            <p style="margin:0 0 6px;font-weight:700;color:#1e293b;font-size:14px;">Markeb Media</p>
            <p style="margin:0;color:#64748b;font-size:12px;">Professional property marketing media</p>
            <p style="margin:12px 0 0;color:#94a3b8;font-size:11px;">
              You're receiving this because you have a booking with Markeb Media.<br/>
              <a href="mailto:commercial@markebmedia.com" style="color:#94a3b8;">Unsubscribe</a>
            </p>
          </div>

        </div>
      </body>
      </html>
    `;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    FROM_EMAIL,
        to:      [clientEmail],
        subject: `Your content is ready to review — ${projectAddress}`,
        html:    emailHTML,
      }),
    });

    if (!resendResponse.ok) {
      const err = await resendResponse.text();
      console.error('Resend error:', err);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Failed to send email' }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: `Notification sent to ${clientEmail}` }),
    };

  } catch (error) {
    console.error('notify-client-review error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};