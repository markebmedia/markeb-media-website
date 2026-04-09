const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email, status, reason } = JSON.parse(event.body);

    if (!email || !status) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const isSuspended = status === 'Suspended';

    const subject = isSuspended
      ? 'Important: Your Markeb Media Account Has Been Suspended'
      : 'Your Markeb Media Account Has Been Reinstated';

    const html = isSuspended ? `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      </head>
      <body style="margin:0;padding:0;background:#f8fafc;font-family:'Inter',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
                
                <!-- Header -->
                <tr>
                  <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:40px;text-align:center;">
                    <img src="https://markebmedia.com/public/images/Markeb Media Logo (2).png" alt="Markeb Media" style="height:60px;width:auto;margin-bottom:16px;">
                    <div style="width:64px;height:64px;background:rgba(239,68,68,0.15);border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">
                      <span style="font-size:32px;">⚠️</span>
                    </div>
                    <h1 style="color:#ffffff;font-size:24px;font-weight:700;margin:0;">Account Suspended</h1>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding:40px;">
                    <p style="color:#1e293b;font-size:16px;line-height:1.6;margin:0 0 24px;">
                      Your Markeb Media client dashboard account has been temporarily suspended.
                    </p>

                    <!-- Reason Box -->
                    <div style="background:#fef2f2;border:2px solid #fecaca;border-radius:12px;padding:20px;margin-bottom:24px;">
                      <div style="font-size:13px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Reason</div>
                      <div style="font-size:15px;color:#7f1d1d;font-weight:600;">${reason || 'Please contact us for more information.'}</div>
                    </div>

                    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
                      While your account is suspended you will not be able to log in to your dashboard or make new bookings. Any existing scheduled bookings may be affected.
                    </p>

                    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 32px;">
                      If you believe this is an error, or you would like to resolve the outstanding issue, please contact us directly and we will get this sorted as quickly as possible.
                    </p>

                    <!-- CTA -->
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center">
                          <a href="mailto:commercial@markebmedia.com" style="display:inline-block;background:linear-gradient(135deg,#B46100,#8a4a00);color:#ffffff;text-decoration:none;padding:16px 32px;border-radius:10px;font-weight:700;font-size:16px;">
                            Contact Us to Resolve
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background:#f8fafc;border-top:2px solid #e2e8f0;padding:24px 40px;text-align:center;">
                    <p style="color:#94a3b8;font-size:13px;margin:0 0 4px;">Markeb Media Ltd — Company No. 15919272</p>
                    <p style="color:#94a3b8;font-size:13px;margin:0;">
                      <a href="mailto:commercial@markebmedia.com" style="color:#B46100;text-decoration:none;">commercial@markebmedia.com</a>
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    ` : `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      </head>
      <body style="margin:0;padding:0;background:#f8fafc;font-family:'Inter',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
                
                <!-- Header -->
                <tr>
                  <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:40px;text-align:center;">
                    <img src="https://markebmedia.com/public/images/Markeb Media Logo (2).png" alt="Markeb Media" style="height:60px;width:auto;margin-bottom:16px;">
                    <div style="width:64px;height:64px;background:rgba(16,185,129,0.15);border-radius:50%;margin:0 auto 16px;">
                      <span style="font-size:32px;line-height:64px;">✅</span>
                    </div>
                    <h1 style="color:#ffffff;font-size:24px;font-weight:700;margin:0;">Account Reinstated</h1>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding:40px;">
                    <p style="color:#1e293b;font-size:16px;line-height:1.6;margin:0 0 24px;">
                      Great news — your Markeb Media client dashboard account has been reinstated and is fully active again.
                    </p>

                    <!-- Green Box -->
                    <div style="background:#f0fdf4;border:2px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px;">
                      <div style="font-size:15px;color:#065f46;font-weight:600;">
                        ✅ You can now log in to your dashboard and make bookings as normal.
                      </div>
                    </div>

                    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 32px;">
                      If you have any questions or need assistance getting back up and running, don't hesitate to get in touch.
                    </p>

                    <!-- CTA -->
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center">
                          <a href="https://markebmedia.com/login" style="display:inline-block;background:linear-gradient(135deg,#B46100,#8a4a00);color:#ffffff;text-decoration:none;padding:16px 32px;border-radius:10px;font-weight:700;font-size:16px;">
                            Log In to Your Dashboard
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background:#f8fafc;border-top:2px solid #e2e8f0;padding:24px 40px;text-align:center;">
                    <p style="color:#94a3b8;font-size:13px;margin:0 0 4px;">Markeb Media Ltd — Company No. 15919272</p>
                    <p style="color:#94a3b8;font-size:13px;margin:0;">
                      <a href="mailto:commercial@markebmedia.com" style="color:#B46100;text-decoration:none;">commercial@markebmedia.com</a>
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    await resend.emails.send({
      from: 'Markeb Media <no-reply@markebmedia.com>',
      to: email,
      bcc: 'commercial@markebmedia.com',
      subject,
      html
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };

  } catch (error) {
    console.error('Send suspension email error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};