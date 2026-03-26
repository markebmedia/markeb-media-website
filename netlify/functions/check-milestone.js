const fetch = require('node-fetch');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = 'Markeb Media Users';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'commercial@markebmedia.com';

// Milestone configuration (Ex VAT prices)
const MILESTONES = [
  { 
    points: 5000, 
    value: 50, 
    type: 'progress',
    subject: '💪 Great start - 5,000 points earned!',
    tier: 'Progress'
  },
  { 
    points: 9900, 
    value: 99, 
    type: 'redemption',
    subject: '🎉 First Free Service Unlocked - £99+ to Spend!',
    tier: 'Entry'
  },
  { 
    points: 15000, 
    value: 150, 
    type: 'progress',
    subject: '💪 Almost there - 15,000 points!',
    tier: 'Progress'
  },
  { 
    points: 16900, 
    value: 169, 
    type: 'redemption',
    subject: '🥉 Bronze Tier Unlocked - £169+ Available!',
    tier: 'Bronze'
  },
  { 
    points: 21900, 
    value: 219, 
    type: 'redemption',
    subject: '🥈 SILVER TIER UNLOCKED - Our Most Popular Package!',
    tier: 'Silver'
  },
  { 
    points: 50000, 
    value: 500, 
    type: 'redemption',
    subject: '🥇 GOLD TIER UNLOCKED - Premium Services Available!',
    tier: 'Gold'
  },
  { 
    points: 74500, 
    value: 745, 
    type: 'redemption',
    subject: '🏆 ELITE STATUS - Complete Branding Package Unlocked!',
    tier: 'Elite'
  }
];

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: JSON.stringify({ message: 'CORS OK' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { userEmail } = JSON.parse(event.body);

    if (!userEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'userEmail is required' })
      };
    }

    // 1. Get user from Airtable
    const user = await getUserFromAirtable(userEmail);
    
    if (!user) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    // 2. Check if email notifications are enabled
    if (user.fields['Email Notifications Enabled'] === false) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          message: 'Email notifications disabled for this user',
          skipped: true 
        })
      };
    }

    // 3. Get booking points from Acuity
    const acuityResponse = await fetch(`${process.env.URL || 'http://localhost:8888'}/.netlify/functions/acuity-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: userEmail })
    });

    if (!acuityResponse.ok) {
      throw new Error('Failed to fetch Acuity data');
    }

    const acuityData = await acuityResponse.json();
    const bookingPoints = Math.floor(acuityData.totalInvestment ?? 0);

    // 4. Get manual points AND last redemption baseline from Airtable
    const pointsData = await fetch(`${process.env.URL || 'http://localhost:8888'}/.netlify/functions/get-manual-points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: userEmail })
    });

    if (!pointsData.ok) {
      throw new Error('Failed to fetch manual points data');
    }

    const pointsResult = await pointsData.json();
    const manualPoints = pointsResult?.manualPoints || 0;
    const lastRedemptionBaseline = pointsResult?.lastRedemptionBaseline || 0;
    
    // 5. Calculate current available balance (same as dashboard)
    const netBookingPoints = Math.max(0, bookingPoints - lastRedemptionBaseline);
    const currentBalance = netBookingPoints + manualPoints;

    // 6. Get last milestone reached
    const lastMilestoneReached = user.fields['Last Milestone Reached'] || 0;

    // 7. Find the HIGHEST milestone they've reached (skip intermediate ones)
    const eligibleMilestones = MILESTONES.filter(m => 
      currentBalance >= m.points && lastMilestoneReached < m.points
    );

    if (eligibleMilestones.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          message: 'No new milestone reached',
          currentBalance,
          lastMilestoneReached 
        })
      };
    }

    // Get the HIGHEST milestone (last one in the eligible array)
    const milestoneToSend = eligibleMilestones[eligibleMilestones.length - 1];

    // 8. Send email via Resend
    const emailSent = await sendMilestoneEmail(user, milestoneToSend, currentBalance);

    if (!emailSent) {
      throw new Error('Failed to send email');
    }

    // 9. Update Airtable with new milestone
    await updateAirtableMilestone(user.id, milestoneToSend.points);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Milestone email sent: ${milestoneToSend.tier} (${milestoneToSend.points} points)`,
        milestone: milestoneToSend,
        currentBalance,
        skippedMilestones: eligibleMilestones.length - 1,
        emailSent: true
      })
    };

  } catch (error) {
    console.error('Error checking milestone:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to check milestone',
        details: error.message 
      })
    };
  }
};

// Helper: Get user from Airtable
async function getUserFromAirtable(email) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}?filterByFormula={Email}='${email}'`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user from Airtable');
  }

  const data = await response.json();
  return data.records && data.records.length > 0 ? data.records[0] : null;
}

// Helper: Update milestone in Airtable
async function updateAirtableMilestone(recordId, milestonePoints) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}/${recordId}`;
  
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fields: {
        'Last Milestone Reached': milestonePoints,
        'Last Email Sent Date': new Date().toISOString()
      }
    })
  });

  if (!response.ok) {
    throw new Error('Failed to update Airtable');
  }

  return await response.json();
}

// Helper: Send milestone email via Resend
async function sendMilestoneEmail(user, milestone, currentBalance) {
  const userName = user.fields['Name'] || 'there';
  const userEmail = user.fields['Email'];
  const pointsValue = (milestone.value).toFixed(2);

  // Generate email HTML based on milestone type
  const emailHtml = generateEmailHtml(userName, milestone, currentBalance);

  const emailData = {
    from: FROM_EMAIL,
    to: userEmail,
    subject: milestone.subject,
    html: emailHtml
  };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(emailData)
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Resend error:', error);
    return false;
  }

  return true;
}

// Helper: Generate email HTML
function generateEmailHtml(userName, milestone, currentBalance) {
  const pointsValue = (milestone.value).toFixed(2);
  
  // Progress email template
  if (milestone.type === 'progress') {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #f7ead5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f7ead5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #FDF3E2; border-radius: 16px; box-shadow: 0 4px 20px rgba(63,77,27,0.12); overflow: hidden;">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%); padding: 40px; text-align: center;">
              <h1 style="margin: 0; color: #FDF3E2; font-size: 32px; font-weight: 700; letter-spacing: -0.02em;">💪 Great Progress!</h1>
              <div style="width: 40px; height: 3px; background: #B46100; margin: 16px auto 0; border-radius: 2px;"></div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              <p style="font-size: 18px; color: #3F4D1B; margin: 0 0 20px 0;">Hi ${userName},</p>

              <p style="font-size: 16px; color: #6b7c2e; line-height: 1.6; margin: 0 0 30px 0;">
                You're building momentum! You've now earned <strong style="color: #B46100;">${milestone.points.toLocaleString()} points</strong> with Markeb Media.
              </p>

              <!-- Progress Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 30px;">
                <tr>
                  <td style="background-color: #fff8ee; border: 2px solid #B46100; border-radius: 12px; padding: 20px;">
                    <p style="font-size: 13px; color: #8a4a00; font-weight: 700; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px;">🎯 Your Next Milestone</p>
                    <p style="font-size: 16px; color: #3F4D1B; margin: 0; line-height: 1.6;">
                      ${milestone.points === 5000
                        ? 'Property Photography at 9,900 points<br><strong>You\'re 51% there!</strong>'
                        : 'Bronze Package at 16,900 points<br><strong>You\'re 89% there — so close!</strong>'}
                    </p>
                  </td>
                </tr>
              </table>

              <p style="font-size: 16px; color: #6b7c2e; line-height: 1.6; margin: 0 0 30px 0;">
                Keep booking to unlock your first free service!
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td style="background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); border-radius: 10px; padding: 16px 32px; text-align: center;">
                    <a href="https://markebmedia.com/login.html" style="color: #FDF3E2; text-decoration: none; font-weight: 600; font-size: 16px; display: block;">View Dashboard</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #3F4D1B; padding: 30px; text-align: center;">
              <p style="margin: 0 0 4px; color: #FDF3E2; font-size: 14px; font-weight: 600;">Thanks for your continued partnership,</p>
              <p style="margin: 0 0 0; color: rgba(253,243,226,0.75); font-size: 14px;">Mark &amp; The Markeb Team</p>
              <div style="width: 32px; height: 2px; background: #B46100; margin: 16px auto; border-radius: 1px;"></div>
              <p style="margin: 0; color: rgba(253,243,226,0.4); font-size: 12px;">Professional Property Media, Marketing &amp; Technology Solution</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  // Redemption email template
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #f7ead5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f7ead5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #FDF3E2; border-radius: 16px; box-shadow: 0 4px 20px rgba(63,77,27,0.12); overflow: hidden;">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%); padding: 40px; text-align: center;">
              <h1 style="margin: 0; color: #FDF3E2; font-size: 32px; font-weight: 700; letter-spacing: -0.02em;">${milestone.subject.split('-')[0].trim()}</h1>
              <div style="width: 40px; height: 3px; background: #B46100; margin: 16px auto 0; border-radius: 2px;"></div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              <p style="font-size: 18px; color: #3F4D1B; margin: 0 0 20px 0;">Hi ${userName},</p>

              <p style="font-size: 16px; color: #6b7c2e; line-height: 1.6; margin: 0 0 30px 0;">
                ${milestone.tier === 'Entry'
                  ? `Congratulations! You've reached <strong style="color: #B46100;">${milestone.points.toLocaleString()} points</strong> — your first redemption milestone!`
                  : milestone.tier === 'Elite'
                  ? `You've done it! <strong style="color: #B46100;">${milestone.points.toLocaleString()} points</strong> earned — you've reached <strong style="color: #3F4D1B;">ELITE STATUS!</strong> 🏆`
                  : `Amazing! You've hit <strong style="color: #B46100;">${milestone.points.toLocaleString()} points</strong> and unlocked our ${milestone.tier.toUpperCase()} tier!`
                }
              </p>

              <!-- Services Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 30px;">
                <tr>
                  <td style="background-color: #f3f7e8; border: 2px solid #3F4D1B; border-radius: 12px; padding: 20px;">
                    <p style="font-size: 13px; color: #3F4D1B; font-weight: 700; margin: 0 0 15px 0; text-transform: uppercase; letter-spacing: 0.5px;">🎁 ${milestone.tier === 'Entry' ? 'You Can Now Redeem:' : 'All Services You Can Now Redeem:'}</p>
                    ${getServicesHtml(milestone.tier)}
                  </td>
                </tr>
              </table>

              <!-- Balance Info -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 30px;">
                <tr>
                  <td style="background-color: #f7ead5; border: 2px solid #e8d9be; border-radius: 12px; padding: 20px;">
                    <p style="margin: 0 0 8px; font-size: 14px; color: #6b7c2e;">💰 <strong style="color: #3F4D1B;">Available to Spend:</strong> £${pointsValue}</p>
                    <p style="margin: 0; font-size: 14px; color: #6b7c2e;">📊 <strong style="color: #3F4D1B;">Total Lifetime Points:</strong> ${currentBalance.toLocaleString()}</p>
                  </td>
                </tr>
              </table>

              <p style="font-size: 16px; color: #6b7c2e; line-height: 1.6; margin: 0 0 30px 0;">
                Your points never expire — redeem now or keep saving for a bigger service!
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td style="background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); border-radius: 10px; padding: 16px 32px; text-align: center;">
                    <a href="https://markebmedia.com/login.html" style="color: #FDF3E2; text-decoration: none; font-weight: 600; font-size: 16px; display: block;">Book Your Free Service</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #3F4D1B; padding: 30px; text-align: center;">
              <p style="margin: 0 0 4px; color: #FDF3E2; font-size: 14px; font-weight: 600;">Thanks for being a valued Markeb Media client,</p>
              <p style="margin: 0; color: rgba(253,243,226,0.75); font-size: 14px;">The Markeb Team</p>
              <div style="width: 32px; height: 2px; background: #B46100; margin: 16px auto; border-radius: 1px;"></div>
              <p style="margin: 0; color: rgba(253,243,226,0.4); font-size: 12px;">Professional Property Media, Marketing &amp; Technology Solution</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

// Helper: Get services HTML based on tier
function getServicesHtml(tier) {
  const services = {
    'Entry': [
      '✓ Property Photography (45 min) - £99.00'
    ],
    'Bronze': [
      '✓ Bronze Package (1h 30m) - £169.00',
      '✓ All In One Drone (45 min) - £179.00',
      '✓ Property Photography (45 min) - £99.00',
      '✓ Property Videography (1 hour) - £129.00',
      '✓ Drone Photography OR Videography (20 min) - £109.00'
    ],
    'Silver': [
      '⭐ Silver Package (1h 30m) - £219.00 ← MOST POPULAR',
      '✓ Bronze Package (1h 30m) - £169.00',
      '✓ All In One Drone (45 min) - £179.00',
      '✓ Property Photography + Videography',
      '✓ Drone services'
    ],
    'Gold': [
      '🥇 Gold Package (2h 30m) - £500.00',
      '✓ Branding Videography Session (3 hours) - £445.00',
      '✓ Branding Photography Session (2 hours) - £345.00',
      '✓ Silver Package - £219.00',
      '✓ Bronze Package - £169.00',
      '✓ All property & drone services'
    ],
    'Elite': [
      '👑 Complete Branding Package - Photo & Video (5 hours) - £745.00',
      '🥇 Gold Package (2h 30m) - £500.00',
      '✓ Branding Videography (3 hours) - £445.00',
      '✓ Branding Photography (2 hours) - £345.00',
      '✓ ALL packages and services'
    ]
  };

  const serviceList = services[tier] || [];
  return serviceList.map(s => `<p style="margin: 5px 0; font-size: 14px; color: #047857;">${s}</p>`).join('');
}