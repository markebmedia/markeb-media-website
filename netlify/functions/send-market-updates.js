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

/// Email Layout Wrapper
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
    .unsubscribe {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid rgba(253,243,226,0.15);
      font-size: 12px;
      color: rgba(253,243,226,0.35);
    }
    .unsubscribe a {
      color: #B46100;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Markeb Media">
      <h1>Property Market Update</h1>
      <div class="header-accent"></div>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <strong>Markeb Media</strong>
      <div class="footer-divider"></div>
      <p style="margin: 0 0 6px;">Professional Property Media, Marketing &amp; Technology Solutions</p>
      <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
      <p style="margin-top: 16px; font-size: 12px; color: rgba(253,243,226,0.4);">
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

  // Randomize the briefing style for variety
  const styles = [
    {
      name: 'market_conditions',
      instruction: 'Lead with overall market direction and transaction volumes, then highlight property type performance'
    },
    {
      name: 'price_performance',
      instruction: 'Lead with average sold price and YoY change, then explain which property types are driving/dragging the market'
    },
    {
      name: 'comparative',
      instruction: 'Compare performance across property types, highlighting the spread between strongest and weakest performers'
    },
    {
      name: 'volume_and_value',
      instruction: 'Balance both transaction volumes and price movements, connecting buyer activity to pricing trends'
    }
  ];

  const selectedStyle = styles[Math.floor(Math.random() * styles.length)];
  console.log(`📝 Using briefing style: ${selectedStyle.name}`);

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
Write 2-3 clear sentences summarising what this data means for estate agents doing valuations.

**Briefing Style:**
${selectedStyle.instruction}

**CRITICAL REQUIREMENTS:**
1. UK English spelling only
2. 2-3 sentences maximum
3. Reference the actual numbers provided
4. State facts clearly - no fluff or sales language
5. Focus on market conditions and property type performance
6. Vary your sentence structure and opening - don't always start the same way

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
- Start every sentence with the region name

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

        <p style="font-size: 16px; line-height: 1.7; color: #6b7c2e;">
          Here's your latest market intelligence for ${region} to help you win more valuations.
        </p>

        <!-- Market Snapshot -->
        <div style="background-color: #fff8ee; border: 2px solid #B46100; border-radius: 12px; padding: 24px; margin: 24px 0;">
          <h3 style="margin-top: 0; color: #8a4a00; font-size: 16px; font-weight: 700;">📍 ${region} Market Snapshot (Last 3 Months)</h3>
          <table role="presentation" style="width: 100%; border-collapse: collapse; margin-top: 16px;">
            <tr>
              <td style="width: 50%; padding: 8px 8px 8px 0; vertical-align: top;">
                <div style="font-size: 12px; color: #9a7a4a; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Average Sold Price</div>
                <div style="font-size: 28px; font-weight: 700; color: #B46100;">£${marketData.snapshot.averagePrice.toLocaleString()}</div>
              </td>
              <td style="width: 50%; padding: 8px 0 8px 8px; vertical-align: top;">
                <div style="font-size: 12px; color: #9a7a4a; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Change vs Last Year</div>
                <div style="font-size: 28px; font-weight: 700; color: ${marketData.snapshot.yoyChange >= 0 ? '#3F4D1B' : '#ef4444'};">
                  ${marketData.snapshot.yoyChange >= 0 ? '+' : ''}${marketData.snapshot.yoyChange}%
                </div>
              </td>
            </tr>
            <tr>
              <td style="width: 50%; padding: 8px 8px 0 0; vertical-align: top;">
                <div style="font-size: 12px; color: #9a7a4a; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Total Sales Completed</div>
                <div style="font-size: 28px; font-weight: 700; color: #B46100;">${marketData.snapshot.totalTransactions}</div>
              </td>
              <td style="width: 50%; padding: 8px 0 0 8px; vertical-align: top;">
                <div style="font-size: 12px; color: #9a7a4a; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Sales Volume Change</div>
                <div style="font-size: 28px; font-weight: 700; color: ${marketData.snapshot.transactionChange >= 0 ? '#3F4D1B' : '#ef4444'};">
                  ${marketData.snapshot.transactionChange >= 0 ? '+' : ''}${marketData.snapshot.transactionChange}%
                </div>
              </td>
            </tr>
          </table>
        </div>

        <h3 style="color: #3F4D1B; margin-top: 32px; font-size: 16px; font-weight: 700;">🏘 Property Type Performance</h3>
        <p style="color: #6b7c2e; margin-bottom: 16px; font-size: 14px;">Average sold prices by property type:</p>

        ${Object.keys(marketData.propertyTypes).map(type => {
          const data = marketData.propertyTypes[type];
          const emoji = {'Detached': '🏠', 'Semi-detached': '🏡', 'Terraced': '🏘', 'Flats': '🏢'}[type];
          return `
            <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f7ead5; border: 2px solid #e8d9be; border-radius: 8px; margin-bottom: 10px;">
              <tr>
                <td style="padding: 16px;">
                  <div style="font-size: 15px; font-weight: 600; color: #3F4D1B;">${emoji} ${type}</div>
                  <div style="font-size: 12px; color: #6b7c2e; margin-top: 4px;">${data.transactions} sales</div>
                </td>
                <td style="padding: 16px; text-align: right;">
                  <div style="font-size: 20px; font-weight: 700; color: #B46100;">£${data.averagePrice.toLocaleString()}</div>
                  <div style="font-size: 13px; font-weight: 600; color: ${data.yoyChange >= 0 ? '#3F4D1B' : '#ef4444'};">
                    ${data.yoyChange >= 0 ? '+' : ''}${data.yoyChange.toFixed(1)}% YoY
                  </div>
                </td>
              </tr>
            </table>
          `;
        }).join('')}

        <!-- Insight Box -->
        <div style="background-color: #fff8ee; border: 2px solid #B46100; border-left: 5px solid #B46100; border-radius: 12px; padding: 20px; margin: 32px 0;">
          <h3 style="margin-top: 0; color: #8a4a00; font-size: 16px; font-weight: 700;">💡 What This Means for Winning Valuations</h3>
          <p style="color: #7a3e00; margin: 0; line-height: 1.7; font-size: 15px;">
            ${insight}
          </p>
        </div>

        <!-- How to Use Box -->
        <div style="background-color: #f3f7e8; border: 2px solid #3F4D1B; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <h3 style="margin-top: 0; color: #3F4D1B; font-size: 16px; font-weight: 700;">📊 How to Use This Intelligence</h3>
          <ul style="color: #6b7c2e; margin: 0; padding-left: 20px; line-height: 1.8; font-size: 14px;">
            <li style="margin-bottom: 8px;">Reference these <strong style="color: #3F4D1B;">actual sold prices</strong> (not asking prices) during valuations</li>
            <li style="margin-bottom: 8px;">Show vendors you understand current market conditions with real data</li>
            <li style="margin-bottom: 8px;">Demonstrate which property types are performing strongest in ${region}</li>
            <li style="margin-bottom: 8px;">Position yourself as the data-driven expert vendors trust</li>
          </ul>
        </div>

        <p style="color: #9a7a4a; font-size: 13px; font-style: italic; margin-top: 32px; border-top: 1px solid #e8d9be; padding-top: 16px;">
          ${marketData.compliance}
        </p>

        <p style="margin-top: 32px; color: #3F4D1B;">Best regards,<br><strong>The Markeb Media Team</strong></p>

        <!-- CTA Box -->
        <div style="background-color: #f7ead5; border: 2px dashed #B46100; border-radius: 8px; padding: 20px; margin-top: 32px; text-align: center;">
          <p style="margin: 0 0 6px; color: #3F4D1B; font-size: 14px; font-weight: 700;">Need professional property media that wins valuations?</p>
          <p style="margin: 0; color: #6b7c2e; font-size: 14px;">Markeb Media provides photography, videography, and social media content that positions you as the premium choice.</p>
        </div>

        <div class="alert alert-info" style="margin-top: 24px;">
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
          <p style="color: #3F4D1B;">Hi ${firstName},</p>

          <p style="font-size: 16px; line-height: 1.7; color: #6b7c2e;">
            Here's your latest market intelligence for ${region} to help you win more valuations.
          </p>

          <!-- Market Snapshot -->
          <div style="background-color: #fff8ee; border: 2px solid #B46100; border-radius: 12px; padding: 24px; margin: 24px 0;">
            <h3 style="margin-top: 0; color: #8a4a00; font-size: 16px; font-weight: 700;">📍 ${region} Market Snapshot (Last 3 Months)</h3>
            <table role="presentation" style="width: 100%; border-collapse: collapse; margin-top: 16px;">
              <tr>
                <td style="width: 50%; padding: 8px 8px 8px 0; vertical-align: top;">
                  <div style="font-size: 12px; color: #9a7a4a; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Average Sold Price</div>
                  <div style="font-size: 28px; font-weight: 700; color: #B46100;">£${marketData.snapshot.averagePrice.toLocaleString()}</div>
                </td>
                <td style="width: 50%; padding: 8px 0 8px 8px; vertical-align: top;">
                  <div style="font-size: 12px; color: #9a7a4a; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Change vs Last Year</div>
                  <div style="font-size: 28px; font-weight: 700; color: ${marketData.snapshot.yoyChange >= 0 ? '#3F4D1B' : '#ef4444'};">
                    ${marketData.snapshot.yoyChange >= 0 ? '+' : ''}${marketData.snapshot.yoyChange}%
                  </div>
                </td>
              </tr>
              <tr>
                <td style="width: 50%; padding: 8px 8px 0 0; vertical-align: top;">
                  <div style="font-size: 12px; color: #9a7a4a; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Total Sales Completed</div>
                  <div style="font-size: 28px; font-weight: 700; color: #B46100;">${marketData.snapshot.totalTransactions}</div>
                </td>
                <td style="width: 50%; padding: 8px 0 0 8px; vertical-align: top;">
                  <div style="font-size: 12px; color: #9a7a4a; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Sales Volume Change</div>
                  <div style="font-size: 28px; font-weight: 700; color: ${marketData.snapshot.transactionChange >= 0 ? '#3F4D1B' : '#ef4444'};">
                    ${marketData.snapshot.transactionChange >= 0 ? '+' : ''}${marketData.snapshot.transactionChange}%
                  </div>
                </td>
              </tr>
            </table>
          </div>

          <h3 style="color: #3F4D1B; margin-top: 32px; font-size: 16px; font-weight: 700;">🏘 Property Type Performance</h3>
          <p style="color: #6b7c2e; margin-bottom: 16px; font-size: 14px;">Average sold prices by property type:</p>

          ${Object.keys(marketData.propertyTypes).map(type => {
            const data = marketData.propertyTypes[type];
            const emoji = {
              'Detached': '🏠',
              'Semi-detached': '🏡',
              'Terraced': '🏘',
              'Flats': '🏢'
            }[type];
            return `
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f7ead5; border: 2px solid #e8d9be; border-radius: 8px; margin-bottom: 10px;">
                <tr>
                  <td style="padding: 16px;">
                    <div style="font-size: 15px; font-weight: 600; color: #3F4D1B;">${emoji} ${type}</div>
                    <div style="font-size: 12px; color: #6b7c2e; margin-top: 4px;">${data.transactions} sales</div>
                  </td>
                  <td style="padding: 16px; text-align: right;">
                    <div style="font-size: 20px; font-weight: 700; color: #B46100;">£${data.averagePrice.toLocaleString()}</div>
                    <div style="font-size: 13px; font-weight: 600; color: ${data.yoyChange >= 0 ? '#3F4D1B' : '#ef4444'};">
                      ${data.yoyChange >= 0 ? '+' : ''}${data.yoyChange.toFixed(1)}% YoY
                    </div>
                  </td>
                </tr>
              </table>
            `;
          }).join('')}

          <!-- Insight Box -->
          <div style="background-color: #fff8ee; border: 2px solid #B46100; border-left: 5px solid #B46100; border-radius: 12px; padding: 20px; margin: 32px 0;">
            <h3 style="margin-top: 0; color: #8a4a00; font-size: 16px; font-weight: 700;">💡 What This Means for Winning Valuations</h3>
            <p style="color: #7a3e00; margin: 0; line-height: 1.7; font-size: 15px;">
              ${insight}
            </p>
          </div>

          <!-- How to Use Box -->
          <div style="background-color: #f3f7e8; border: 2px solid #3F4D1B; border-radius: 12px; padding: 20px; margin: 24px 0;">
            <h3 style="margin-top: 0; color: #3F4D1B; font-size: 16px; font-weight: 700;">📊 How to Use This Intelligence</h3>
            <ul style="color: #6b7c2e; margin: 0; padding-left: 20px; line-height: 1.8; font-size: 14px;">
              <li style="margin-bottom: 8px;">Reference these <strong style="color: #3F4D1B;">actual sold prices</strong> (not asking prices) during valuations</li>
              <li style="margin-bottom: 8px;">Show vendors you understand current market conditions with real data</li>
              <li style="margin-bottom: 8px;">Demonstrate which property types are performing strongest in ${region}</li>
              <li style="margin-bottom: 8px;">Position yourself as the data-driven expert vendors trust</li>
            </ul>
          </div>

          <p style="color: #9a7a4a; font-size: 13px; font-style: italic; margin-top: 32px; border-top: 1px solid #e8d9be; padding-top: 16px;">
            ${marketData.compliance}
          </p>

          <p style="margin-top: 32px; color: #3F4D1B;">Best regards,<br><strong>The Markeb Media Team</strong></p>

          <!-- CTA Box -->
          <div style="background-color: #f7ead5; border: 2px dashed #B46100; border-radius: 8px; padding: 20px; margin-top: 32px; text-align: center;">
            <p style="margin: 0 0 6px; color: #3F4D1B; font-size: 14px; font-weight: 700;">Need professional property media that wins valuations?</p>
            <p style="margin: 0; color: #6b7c2e; font-size: 14px;">Markeb Media provides photography, videography, and social media content that positions you as the premium choice.</p>
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