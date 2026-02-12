const Airtable = require('airtable');
const { Resend } = require('resend');

const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(process.env.AIRTABLE_BASE_ID);
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const BCC_EMAIL = 'commercial@markebmedia.com';
const SITE_URL = 'https://markebmedia.com';
const LOGO_URL = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';

// Email Layout Wrapper
function getEmailLayout(content) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markeb Media - Market Update</title>
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
    .footer {
      background-color: #f8fafc;
      padding: 30px;
      text-align: center;
      color: #64748b;
      font-size: 14px;
      border-top: 2px solid #e2e8f0;
    }
    .footer a {
      color: #3b82f6;
      text-decoration: none;
    }
    .unsubscribe {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Markeb Media">
      <h1>Property Market Update</h1>
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
        Need help? <a href="${SITE_URL}/contact">Contact us</a>
      </p>
      <div class="unsubscribe">
        <p>
          You're receiving this because you subscribed to property market updates.<br>
          To manage your email preferences, contact us at 
          <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

exports.handler = async (event) => {
  console.log('=== Market Updates Function Called ===');
  
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
      body: JSON.stringify({ success: false, error: 'Method Not Allowed' })
    };
  }

  try {
    const { region, subject, content, sendPreview, recipients, marketData } = JSON.parse(event.body);

    console.log('Request data:', { region, subject, sendPreview, recipientsCount: recipients?.length });

    if (!region || !subject || !content) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Missing required fields: region, subject, or content' })
      };
    }

    if (!recipients || recipients.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'No recipients provided' })
      };
    }

    if (!marketData || !marketData.snapshot || !marketData.propertyTypes) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Market data is required. Please fetch market data first.' })
      };
    }

    // TEST MODE - Send to admin only
    if (sendPreview) {
      console.log('Sending test email to admin...');
      
      const testContent = content.replace(/\[Name\]/g, 'Admin');
      
      const previewHtml = `
        <div class="alert alert-info">
          <strong>🧪 TEST EMAIL PREVIEW</strong><br>
          This is how your market update will look to customers.<br><br>
          <strong>Region:</strong> ${region}<br>
          <strong>Recipients:</strong> ${recipients.length} customer${recipients.length !== 1 ? 's' : ''}
        </div>

        <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 24px; margin: 24px 0;">
          <h3 style="margin-top: 0; color: #1e40af;">📍 Last 3 Months at a Glance</h3>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 16px;">
            <div>
              <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Average Sold Price</div>
              <div style="font-size: 28px; font-weight: 700; color: #1e40af;">£${marketData.snapshot.averagePrice.toLocaleString()}</div>
            </div>
            <div>
              <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Change vs Previous 3 Months</div>
              <div style="font-size: 28px; font-weight: 700; color: ${marketData.snapshot.momChange >= 0 ? '#10b981' : '#ef4444'};">
                ${marketData.snapshot.momChange >= 0 ? '+' : ''}${marketData.snapshot.momChange}%
              </div>
            </div>
            <div>
              <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Change vs Last Year</div>
              <div style="font-size: 28px; font-weight: 700; color: ${marketData.snapshot.yoyChange >= 0 ? '#10b981' : '#ef4444'};">
                ${marketData.snapshot.yoyChange >= 0 ? '+' : ''}${marketData.snapshot.yoyChange}%
              </div>
            </div>
            <div>
              <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Total Sales Completed</div>
              <div style="font-size: 28px; font-weight: 700; color: #1e40af;">${marketData.snapshot.totalTransactions}</div>
            </div>
          </div>
        </div>

        <h3 style="color: #1e293b; margin-top: 32px;">🏘 Property Type Breakdown</h3>
        ${Object.keys(marketData.propertyTypes).map(type => {
          const data = marketData.propertyTypes[type];
          const emoji = {'Detached': '🏠', 'Semi-detached': '🏡', 'Terraced': '🏘', 'Flats': '🏢'}[type];
          return `
            <div style="background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
              ${emoji} ${type}: £${data.averagePrice.toLocaleString()} (${data.yoyChange >= 0 ? '+' : ''}${data.yoyChange.toFixed(1)}% YoY)
            </div>
          `;
        }).join('')}

        <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <h3 style="margin-top: 0; color: #92400e;">💡 What This Means for Valuations</h3>
          <p style="color: #78350f; margin: 0;">${marketData.insight}</p>
        </div>

        <div class="alert alert-info">
          <strong>📧 Ready to send?</strong><br>
          Uncheck "Send test email" and click send to deliver to all ${recipients.length} opted-in customer${recipients.length !== 1 ? 's' : ''}.
        </div>
      `;

      const emailHtml = getEmailLayout(previewHtml);

      await resend.emails.send({
        from: FROM_EMAIL,
        to: BCC_EMAIL,
        subject: `[TEST] ${subject}`,
        html: emailHtml
      });

      console.log('✓ Test email sent');

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          sentCount: 1,
          message: 'Test email sent to commercial@markebmedia.com'
        })
      };
    }

    // LIVE MODE - Send to all recipients
    console.log(`Sending to ${recipients.length} recipients...`);
    let sentCount = 0;
    const errors = [];

    for (const recipient of recipients) {
      try {
        // Personalize content with customer name
        const firstName = (recipient.name || 'there').split(' ')[0];
        const personalizedContent = content.replace(/\[Name\]/g, firstName);

        const emailContent = `
          <p>Hi ${firstName},</p>
          
          <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 24px; margin: 24px 0;">
            <h3 style="margin-top: 0; color: #1e40af;">📍 Last 3 Months at a Glance</h3>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 16px;">
              <div>
                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Average Sold Price</div>
                <div style="font-size: 28px; font-weight: 700; color: #1e40af;">£${marketData.snapshot.averagePrice.toLocaleString()}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Change vs Previous 3 Months</div>
                <div style="font-size: 28px; font-weight: 700; color: ${marketData.snapshot.momChange >= 0 ? '#10b981' : '#ef4444'};">
                  ${marketData.snapshot.momChange >= 0 ? '+' : ''}${marketData.snapshot.momChange}%
                </div>
              </div>
              <div>
                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Change vs Last Year</div>
                <div style="font-size: 28px; font-weight: 700; color: ${marketData.snapshot.yoyChange >= 0 ? '#10b981' : '#ef4444'};">
                  ${marketData.snapshot.yoyChange >= 0 ? '+' : ''}${marketData.snapshot.yoyChange}%
                </div>
              </div>
              <div>
                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Total Sales Completed</div>
                <div style="font-size: 28px; font-weight: 700; color: #1e40af;">${marketData.snapshot.totalTransactions}</div>
              </div>
            </div>
          </div>

          <h3 style="color: #1e293b; margin-top: 32px;">🏘 Property Type Breakdown</h3>
          <p style="color: #64748b; margin-bottom: 16px;">Average sold prices by property type:</p>

          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${Object.keys(marketData.propertyTypes).map(type => {
              const data = marketData.propertyTypes[type];
              const emoji = {
                'Detached': '🏠',
                'Semi-detached': '🏡',
                'Terraced': '🏘',
                'Flats': '🏢'
              }[type];
              
              return `
                <div style="background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 8px; padding: 16px; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <div style="font-size: 16px; font-weight: 600; color: #1e293b;">${emoji} ${type}</div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${data.transactions} sales</div>
                  </div>
                  <div style="text-align: right;">
                    <div style="font-size: 20px; font-weight: 700; color: #3b82f6;">£${data.averagePrice.toLocaleString()}</div>
                    <div style="font-size: 13px; font-weight: 600; color: ${data.yoyChange >= 0 ? '#10b981' : '#ef4444'};">
                      ${data.yoyChange >= 0 ? '+' : ''}${data.yoyChange.toFixed(1)}% YoY
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 12px; padding: 20px; margin: 32px 0;">
            <h3 style="margin-top: 0; color: #92400e;">💡 What This Means for Valuations</h3>
            <p style="color: #78350f; margin: 0; line-height: 1.7;">
              ${marketData.insight}
            </p>
          </div>

          <div style="background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 24px 0;">
            <h3 style="margin-top: 0; color: #1e293b;">📊 How to Use This Data</h3>
            <ul style="color: #475569; margin: 0; padding-left: 20px;">
              <li style="margin-bottom: 8px;">Support realistic pricing during valuations</li>
              <li style="margin-bottom: 8px;">Reassure vendors using <strong>sold</strong>, not asking, prices</li>
              <li style="margin-bottom: 8px;">Handle objections around "the market slowing"</li>
            </ul>
          </div>

          <p style="color: #64748b; font-size: 13px; font-style: italic; margin-top: 32px;">
            ${marketData.compliance}
          </p>

          <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
        `;

        const emailHtml = getEmailLayout(emailContent);

        await resend.emails.send({
          from: FROM_EMAIL,
          to: recipient.email,
          bcc: BCC_EMAIL,
          subject: subject,
          html: emailHtml
        });

        sentCount++;
        console.log(`✓ Sent to ${recipient.email}`);
        
        // Rate limiting: 100ms delay between sends
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`✗ Failed to send to ${recipient.email}:`, error);
        errors.push({ email: recipient.email, error: error.message });
      }
    }

    console.log(`=== Completed: ${sentCount} sent, ${errors.length} failed ===`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        sentCount,
        errors: errors.length > 0 ? errors : undefined,
        message: `Sent to ${sentCount} recipient${sentCount !== 1 ? 's' : ''}`
      })
    };

  } catch (error) {
    console.error('Error sending market updates:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};