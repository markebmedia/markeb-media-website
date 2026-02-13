const Anthropic = require('@anthropic-ai/sdk');
const Airtable = require('airtable');
const { Resend } = require('resend');

// Initialize services
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(process.env.AIRTABLE_BASE_ID);
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const BCC_EMAIL = 'commercial@markebmedia.com';
const SITE_URL = 'https://markebmedia.com';
const LOGO_URL = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

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
        Professional Property Media, Marketing & Technology Solutions<br>
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

/**
 * Generate AI-powered market insight using Claude
 * This positions the data as a valuation-winning tool
 */
async function generateMarketInsight(region, marketData) {
  console.log('🧠 Generating AI market insight with Claude...');

  const prompt = `
You are the UK's leading property market analyst providing clear, actionable intelligence to estate agents.

**Market Data for ${region}:**

**Overall Market (Last 3 Months):**
- Average Sold Price: £${marketData.snapshot.averagePrice.toLocaleString()}
- Year-on-Year Change: ${marketData.snapshot.yoyChange >= 0 ? '+' : ''}${marketData.snapshot.yoyChange}%
- Total Completed Sales: ${marketData.snapshot.totalTransactions}
- vs Last Year Sales: ${marketData.snapshot.previousYearTransactions} (${marketData.snapshot.transactionChange >= 0 ? '+' : ''}${marketData.snapshot.transactionChange}% change)

**Property Type Performance:**
${Object.entries(marketData.propertyTypes).map(([type, data]) => 
  `- ${type}: £${data.averagePrice.toLocaleString()} (${data.yoyChange >= 0 ? '+' : ''}${data.yoyChange}% YoY, ${data.transactions} sales)`
).join('\n')}

**Your Task:**
Write 2-3 clear sentences summarising what this data means for estate agents doing valuations. Be factual and specific.

**CRITICAL REQUIREMENTS:**
1. UK English spelling only
2. 2-3 sentences maximum
3. Reference the actual numbers provided
4. State facts clearly - no fluff or sales language
5. Focus on market conditions and property type performance

**What to cover:**
- Brief summary of market direction (growing/stable/cooling)
- Which property types are strongest/weakest
- One clear takeaway for pricing strategy

**Tone:** 
Senior analyst giving a factual briefing. Clear, concise, data-driven.

**DO NOT:**
- Use bullet points
- Write sales copy or pitches
- Give generic advice
- Mention Markeb Media
- Use exclamation marks

Generate the insight now:
`;

  try {
    const message = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 400,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    });

    const insight = message.content[0].text.trim();
    console.log('✅ AI market insight generated successfully');
    return insight;
  } catch (error) {
    console.error('❌ Error generating AI insight:', error);
    // Fallback to a generic insight if AI fails
    return `The ${region} market has shown ${marketData.snapshot.yoyChange >= 0 ? 'growth' : 'adjustment'} with average prices at £${marketData.snapshot.averagePrice.toLocaleString()}, ${Math.abs(marketData.snapshot.yoyChange)}% ${marketData.snapshot.yoyChange >= 0 ? 'up' : 'down'} year-on-year. With ${marketData.snapshot.totalTransactions} completed sales, vendors need data-driven pricing strategies and professional presentation to achieve the best possible outcome in current conditions.`;
  }
}

exports.handler = async (event) => {
  console.log('=== Market Updates Function Called ===');

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
    const { region, subject, sendPreview, recipients, marketData, generateInsight } = JSON.parse(event.body);

    console.log('Request data:', { region, subject, sendPreview, recipientsCount: recipients?.length, generateInsight });

    if (!region || !subject) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Missing required fields: region or subject' })
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

    // ⭐ GENERATE AI INSIGHT if requested
    let insight = marketData.insight; // Use existing insight by default
    
    if (generateInsight) {
      console.log('🤖 AI insight generation requested...');
      insight = await generateMarketInsight(region, marketData);
    }

    // TEST MODE - Send to admin only
    if (sendPreview) {
      console.log('Sending test email to admin...');
      
      const previewHtml = `
        <div class="alert alert-info">
          <strong>🧪 TEST EMAIL PREVIEW</strong><br>
          This is how your market update will look to customers.<br><br>
          <strong>Region:</strong> ${region}<br>
          <strong>Recipients:</strong> ${recipients.length} customer${recipients.length !== 1 ? 's' : ''}
        </div>

        <p>Hi there,</p>

        <p style="font-size: 16px; line-height: 1.7; color: #475569;">
          Here's your latest market intelligence for ${region} to help you win more valuations.
        </p>

        <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 24px; margin: 24px 0;">
          <h3 style="margin-top: 0; color: #1e40af;">📍 ${region} Market Snapshot (Last 3 Months)</h3>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 16px;">
            <div>
              <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Average Sold Price</div>
              <div style="font-size: 28px; font-weight: 700; color: #1e40af;">£${marketData.snapshot.averagePrice.toLocaleString()}</div>
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
            <div>
              <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Sales Volume Change</div>
              <div style="font-size: 28px; font-weight: 700; color: ${marketData.snapshot.transactionChange >= 0 ? '#10b981' : '#ef4444'};">
                ${marketData.snapshot.transactionChange >= 0 ? '+' : ''}${marketData.snapshot.transactionChange}%
              </div>
            </div>
          </div>
        </div>

        <h3 style="color: #1e293b; margin-top: 32px;">🏘 Property Type Performance</h3>
        <p style="color: #64748b; margin-bottom: 16px;">Average sold prices by property type:</p>

        <div style="display: flex; flex-direction: column; gap: 12px;">
          ${Object.keys(marketData.propertyTypes).map(type => {
            const data = marketData.propertyTypes[type];
            const emoji = {'Detached': '🏠', 'Semi-detached': '🏡', 'Terraced': '🏘', 'Flats': '🏢'}[type];
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
          <h3 style="margin-top: 0; color: #92400e;">💡 What This Means for Winning Valuations</h3>
          <p style="color: #78350f; margin: 0; line-height: 1.7; font-size: 15px;">
            ${insight}
          </p>
        </div>

        <div style="background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <h3 style="margin-top: 0; color: #1e293b;">📊 How to Use This Intelligence</h3>
          <ul style="color: #475569; margin: 0; padding-left: 20px; line-height: 1.8;">
            <li style="margin-bottom: 8px;">Reference these <strong>actual sold prices</strong> (not asking prices) during valuations</li>
            <li style="margin-bottom: 8px;">Show vendors you understand current market conditions with real data</li>
            <li style="margin-bottom: 8px;">Demonstrate which property types are performing strongest in ${region}</li>
            <li style="margin-bottom: 8px;">Position yourself as the data-driven expert vendors trust</li>
          </ul>
        </div>

        <p style="color: #64748b; font-size: 13px; font-style: italic; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
          ${marketData.compliance}
        </p>

        <p style="margin-top: 32px;">Best regards,<br><strong>The Markeb Media Team</strong></p>

        <div style="background: #f8fafc; border: 2px dashed #e2e8f0; border-radius: 8px; padding: 16px; margin-top: 32px; text-align: center;">
          <p style="margin: 0; color: #64748b; font-size: 14px;">
            <strong>Need professional property media that wins valuations?</strong><br>
            Markeb Media provides photography, videography, and social media content that positions you as the premium choice.
          </p>
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
          insight: insight,
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
        const firstName = (recipient.name || 'there').split(' ')[0];

        const emailContent = `
          <p>Hi ${firstName},</p>

          <p style="font-size: 16px; line-height: 1.7; color: #475569;">
            Here's your latest market intelligence for ${region} to help you win more valuations.
          </p>
          
          <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 24px; margin: 24px 0;">
            <h3 style="margin-top: 0; color: #1e40af;">📍 ${region} Market Snapshot (Last 3 Months)</h3>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 16px;">
              <div>
                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Average Sold Price</div>
                <div style="font-size: 28px; font-weight: 700; color: #1e40af;">£${marketData.snapshot.averagePrice.toLocaleString()}</div>
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
              <div>
                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Sales Volume Change</div>
                <div style="font-size: 28px; font-weight: 700; color: ${marketData.snapshot.transactionChange >= 0 ? '#10b981' : '#ef4444'};">
                  ${marketData.snapshot.transactionChange >= 0 ? '+' : ''}${marketData.snapshot.transactionChange}%
                </div>
              </div>
            </div>
          </div>

          <h3 style="color: #1e293b; margin-top: 32px;">🏘 Property Type Performance</h3>
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
            <h3 style="margin-top: 0; color: #92400e;">💡 What This Means for Winning Valuations</h3>
            <p style="color: #78350f; margin: 0; line-height: 1.7; font-size: 15px;">
              ${insight}
            </p>
          </div>

          <div style="background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 24px 0;">
            <h3 style="margin-top: 0; color: #1e293b;">📊 How to Use This Intelligence</h3>
            <ul style="color: #475569; margin: 0; padding-left: 20px; line-height: 1.8;">
              <li style="margin-bottom: 8px;">Reference these <strong>actual sold prices</strong> (not asking prices) during valuations</li>
              <li style="margin-bottom: 8px;">Show vendors you understand current market conditions with real data</li>
              <li style="margin-bottom: 8px;">Demonstrate which property types are performing strongest in ${region}</li>
              <li style="margin-bottom: 8px;">Position yourself as the data-driven expert vendors trust</li>
            </ul>
          </div>

          <p style="color: #64748b; font-size: 13px; font-style: italic; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
            ${marketData.compliance}
          </p>

          <p style="margin-top: 32px;">Best regards,<br><strong>The Markeb Media Team</strong></p>

          <div style="background: #f8fafc; border: 2px dashed #e2e8f0; border-radius: 8px; padding: 16px; margin-top: 32px; text-align: center;">
            <p style="margin: 0; color: #64748b; font-size: 14px;">
              <strong>Need professional property media that wins valuations?</strong><br>
              Markeb Media provides photography, videography, and social media content that positions you as the premium choice.
            </p>
          </div>
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
        insight: insight,
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