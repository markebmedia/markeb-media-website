const Airtable = require('airtable');
const { Resend } = require('resend');

const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(process.env.AIRTABLE_BASE_ID);
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Markeb Media <commercial@markebmedia.com>';
const BCC_EMAIL = 'commercial@markebmedia.com';
const SITE_URL = 'https://markebmedia.com';
const LOGO_URL = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';

// QuickChart.io - Free chart image generation service
const QUICKCHART_URL = 'https://quickchart.io/chart';

// Generate chart URL for price trends
function generatePriceChartUrl(historicalPrices, region) {
  const labels = historicalPrices.slice(-6).map(d => {
    const date = new Date(d.month);
    return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  });
  
  const prices = historicalPrices.slice(-6).map(d => d.price);
  
  const chartConfig = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Average Price (£)',
        data: prices,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      title: {
        display: true,
        text: `${region} - 6 Month Price Trend`,
        fontSize: 16,
        fontColor: '#1e293b'
      },
      scales: {
        yAxes: [{
          ticks: {
            callback: function(value) {
              return '£' + value.toLocaleString();
            }
          }
        }]
      },
      legend: {
        display: false
      }
    }
  };
  
  return `${QUICKCHART_URL}?width=600&height=300&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
}

// Generate chart URL for sales volume
function generateVolumeChartUrl(historicalVolumes, region) {
  const labels = historicalVolumes.slice(-6).map(d => {
    const date = new Date(d.month);
    return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  });
  
  const volumes = historicalVolumes.slice(-6).map(d => d.volume);
  
  const chartConfig = {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Sales Volume',
        data: volumes,
        backgroundColor: '#10b981',
        borderColor: '#059669',
        borderWidth: 2
      }]
    },
    options: {
      title: {
        display: true,
        text: `${region} - 6 Month Sales Volume`,
        fontSize: 16,
        fontColor: '#1e293b'
      },
      scales: {
        yAxes: [{
          ticks: {
            beginAtZero: true
          }
        }]
      },
      legend: {
        display: false
      }
    }
  };
  
  return `${QUICKCHART_URL}?width=600&height=300&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
}

// Generate market health gauge chart
function generateHealthGaugeUrl(healthScore, status) {
  const chartConfig = {
    type: 'radialGauge',
    data: {
      datasets: [{
        data: [healthScore],
        backgroundColor: getHealthColor(healthScore)
      }]
    },
    options: {
      domain: [0, 100],
      trackColor: '#e2e8f0',
      centerPercentage: 80,
      centerArea: {
        text: status,
        fontSize: 24
      },
      roundedCorners: true
    }
  };
  
  return `${QUICKCHART_URL}?width=400&height=300&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
}

function getHealthColor(score) {
  if (score >= 80) return '#10b981'; // Green
  if (score >= 65) return '#3b82f6'; // Blue
  if (score >= 50) return '#f59e0b'; // Orange
  if (score >= 35) return '#ef4444'; // Red
  return '#991b1b'; // Dark red
}

// Email Layout Wrapper with Charts
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
    .market-content {
      background-color: #f8fafc;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      margin: 24px 0;
      line-height: 1.8;
    }
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin: 24px 0;
    }
    .stat-card {
      background: #f8fafc;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      padding: 20px;
      text-align: center;
    }
    .stat-value {
      font-size: 28px;
      font-weight: 700;
      color: #3b82f6;
      margin-bottom: 8px;
    }
    .stat-label {
      font-size: 13px;
      color: #64748b;
      font-weight: 600;
    }
    .chart-container {
      margin: 24px 0;
      text-align: center;
    }
    .chart-container img {
      max-width: 100%;
      height: auto;
      border-radius: 12px;
      border: 2px solid #e2e8f0;
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
    .alert-success {
      background-color: #f0fdf4;
      border: 2px solid #10b981;
      color: #065f46;
    }
    .alert-warning {
      background-color: #fef3c7;
      border: 2px solid #f59e0b;
      color: #92400e;
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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { region, subject, content, sendPreview, recipients, marketData } = JSON.parse(event.body);

    if (!region || !subject || !content) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Missing required fields' })
      };
    }

    // Generate chart URLs if market data is provided
    let priceChartUrl = '';
    let volumeChartUrl = '';
    let healthGaugeUrl = '';
    let statsHtml = '';

    if (marketData) {
      priceChartUrl = generatePriceChartUrl(marketData.historicalPrices, region);
      volumeChartUrl = generateVolumeChartUrl(marketData.historicalVolumes, region);
      healthGaugeUrl = generateHealthGaugeUrl(marketData.marketHealth.score, marketData.marketHealth.status);
      
      // Build stats cards
      statsHtml = `
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-value">£${marketData.averagePrice.toLocaleString()}</div>
            <div class="stat-label">Average Price</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${marketData.annualChange > 0 ? '+' : ''}${marketData.annualChange.toFixed(1)}%</div>
            <div class="stat-label">Annual Change</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${marketData.salesVolume.toLocaleString()}</div>
            <div class="stat-label">Sales Volume</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${marketData.marketHealth.emoji} ${marketData.marketHealth.score}/100</div>
            <div class="stat-label">Market Health</div>
          </div>
        </div>
      `;
    }

    // TEST MODE - Send to admin only
    if (sendPreview) {
      const testContent = content.replace(/\[Name\]/g, 'Admin');
      
      const previewHtml = `
        <div class="alert alert-info">
          <strong>🧪 TEST EMAIL PREVIEW</strong><br>
          This is how your market update will look to customers.<br><br>
          <strong>Region:</strong> ${region}<br>
          <strong>Recipients:</strong> ${recipients.length} customer${recipients.length !== 1 ? 's' : ''}
        </div>

        ${statsHtml}

        ${priceChartUrl ? `
          <div class="chart-container">
            <img src="${priceChartUrl}" alt="Price Trend Chart">
          </div>
        ` : ''}

        ${volumeChartUrl ? `
          <div class="chart-container">
            <img src="${volumeChartUrl}" alt="Sales Volume Chart">
          </div>
        ` : ''}

        <div class="market-content">
          ${testContent.replace(/\n/g, '<br>')}
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

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          sentCount: 1,
          message: 'Test email sent to commercial@markebmedia.com'
        })
      };
    }

    // LIVE MODE - Send to all recipients
    let sentCount = 0;
    const errors = [];

    for (const recipient of recipients) {
      try {
        // Personalize content with customer name
        const personalizedContent = content.replace(/\[Name\]/g, recipient.name);

        const emailContent = `
          <p>Hi ${recipient.name},</p>
          
          ${statsHtml}

          ${priceChartUrl ? `
            <div class="chart-container">
              <img src="${priceChartUrl}" alt="${region} Price Trend">
            </div>
          ` : ''}

          ${volumeChartUrl ? `
            <div class="chart-container">
              <img src="${volumeChartUrl}" alt="${region} Sales Volume">
            </div>
          ` : ''}

          <div class="market-content">
            ${personalizedContent.replace(/\n/g, '<br>')}
          </div>

          <div class="alert alert-info">
            <strong>📊 Data Source</strong><br>
            UK House Price Index (HM Land Registry)
          </div>

          <p>Stay ahead of the market with Markeb Media's professional property content services.</p>
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
        
        // Rate limiting: 100ms delay between sends
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`Failed to send to ${recipient.email}:`, error);
        errors.push({ email: recipient.email, error: error.message });
      }
    }

    // Log to Airtable (optional - create "Market Update History" table if you want tracking)
    try {
      await base('Market Update History').create({
        'Region': region,
        'Subject': subject,
        'Recipients Count': sentCount,
        'Sent Date': new Date().toISOString(),
        'Sent By': 'Admin',
        'Market Data': marketData ? JSON.stringify({
          averagePrice: marketData.averagePrice,
          annualChange: marketData.annualChange,
          marketHealth: marketData.marketHealth.status
        }) : null
      });
    } catch (error) {
      console.log('Could not log to history (table may not exist):', error.message);
      // Non-critical, continue
    }

    return {
      statusCode: 200,
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
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};