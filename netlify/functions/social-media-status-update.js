// Netlify Function: /.netlify/functions/social-media-status-update.js
// Triggered by Airtable automation when Content Planner status changes.
// Email styles match email-service.js exactly.

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL     = 'Markeb Media <marketing@markebmedia.com>';
const INTERNAL_EMAIL = 'marketing@markebmedia.com';
const CC_EMAIL       = 'commercial@markebmedia.com';
const SITE_URL       = 'https://markebmedia.com';
const LOGO_URL       = 'https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png';
const DASHBOARD_URL  = 'https://markebmedia.com/website/dashboard.html';

// ─── Shared layout (matches email-service.js getEmailLayout) ──────────────────

function getEmailLayout(content) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markeb Media</title>
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
    .booking-details {
      background-color: #f8fafc;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      margin: 24px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #e2e8f0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      color: #64748b;
      font-weight: 600;
    }
    .detail-value {
      color: #1e293b;
      font-weight: 600;
      text-align: right;
      max-width: 60%;
    }
    .button {
      display: inline-block;
      background-color: #3b82f6;
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: #ffffff !important;
      padding: 14px 32px;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 600;
      margin: 20px 0;
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
    .alert-warning {
      background-color: #fef3c7;
      border: 2px solid #f59e0b;
      color: #92400e;
    }
    .alert-success {
      background-color: #f0fdf4;
      border: 2px solid #10b981;
      color: #065f46;
    }
    .footer {
      background-color: #f8fafc;
      padding: 30px;
      text-align: center;
      color: #64748b;
      font-size: 14px;
    }
    .footer a {
      color: #3b82f6;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Markeb Media">
      <h1>Markeb Media</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>
        <strong>Markeb Media</strong><br>
        Professional Property Media, Marketing &amp; Technology Solution<br>
        <a href="mailto:marketing@markebmedia.com">marketing@markebmedia.com</a>
      </p>
      <p style="margin-top: 20px; font-size: 12px; color: #94a3b8;">
        Need help? <a href="${SITE_URL}/contact">Contact us</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Email templates ───────────────────────────────────────────────────────────

function buildReadyForReview(r) {
  const content = `
    <h2>👀 Your Content is Ready to Review</h2>
    <p>Hi ${r.clientName},</p>
    <p>Your latest content has been prepared by the Markeb Media team and is now ready for your approval. Please take a look and let us know if you're happy for it to go ahead.</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Post Idea</span>
        <span class="detail-value">${r.idea}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Platform(s)</span>
        <span class="detail-value">${r.platforms}</span>
      </div>
      ${r.contentType ? `
      <div class="detail-row">
        <span class="detail-label">Content Type</span>
        <span class="detail-value">${r.contentType}</span>
      </div>` : ''}
      ${r.contentPillar ? `
      <div class="detail-row">
        <span class="detail-label">Content Pillar</span>
        <span class="detail-value">${r.contentPillar}</span>
      </div>` : ''}
      ${r.postDate ? `
      <div class="detail-row">
        <span class="detail-label">Proposed Go Live Date</span>
        <span class="detail-value">${r.postDate}</span>
      </div>` : ''}
      ${r.assignee ? `
      <div class="detail-row">
        <span class="detail-label">Created By</span>
        <span class="detail-value">${r.assignee}</span>
      </div>` : ''}
    </div>

    <div class="alert alert-info">
      <strong>✅ How to review your content</strong><br>
      Log in to your dashboard, go to <strong>Content Calendar</strong> in the left menu, find <strong>${r.postDate || 'your scheduled date'}</strong> and click on it to view, approve or request changes.
    </div>

    <center>
      <a href="${DASHBOARD_URL}" class="button">Go to My Dashboard</a>
    </center>

    <div class="alert alert-warning">
      <strong>⚠️ Please do not reply to this email</strong><br>
      All approvals and change requests must be submitted through your dashboard so our team is notified correctly.
    </div>

    <p>If you have any questions, feel free to reach out at <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a></p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;
  return {
    subject: `Content Ready to Review — ${r.idea}`,
    html: getEmailLayout(content)
  };
}

function buildApproved(r) {
  const content = `
    <h2>✅ Content Approved — Ready to Schedule</h2>
    <p>The following content has been approved by the client and is ready to be scheduled for publishing.</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Client</span>
        <span class="detail-value">${r.clientName}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Post Idea</span>
        <span class="detail-value">${r.idea}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Platform(s)</span>
        <span class="detail-value">${r.platforms}</span>
      </div>
      ${r.contentType ? `
      <div class="detail-row">
        <span class="detail-label">Content Type</span>
        <span class="detail-value">${r.contentType}</span>
      </div>` : ''}
      ${r.contentPillar ? `
      <div class="detail-row">
        <span class="detail-label">Content Pillar</span>
        <span class="detail-value">${r.contentPillar}</span>
      </div>` : ''}
      ${r.postDate ? `
      <div class="detail-row">
        <span class="detail-label">Target Date</span>
        <span class="detail-value">${r.postDate}</span>
      </div>` : ''}
      ${r.assignee ? `
      <div class="detail-row">
        <span class="detail-label">Assignee</span>
        <span class="detail-value">${r.assignee}</span>
      </div>` : ''}
    </div>

    <div class="alert alert-success">
      <strong>📅 Next step</strong><br>
      Please proceed with scheduling this post in the content calendar.
    </div>

    <center>
      <a href="${DASHBOARD_URL}" class="button">Open Content Calendar</a>
    </center>
  `;
  return {
    subject: `Content Approved — ${r.clientName} | ${r.idea}`,
    html: getEmailLayout(content)
  };
}

function buildScheduled(r) {
  const content = `
    <h2>📅 Your Content is Scheduled</h2>
    <p>Hi ${r.clientName},</p>
    <p>Great news — your content has been approved and is now scheduled to go live. Here's a summary of what's coming up.</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Post Idea</span>
        <span class="detail-value">${r.idea}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Platform(s)</span>
        <span class="detail-value">${r.platforms}</span>
      </div>
      ${r.contentType ? `
      <div class="detail-row">
        <span class="detail-label">Content Type</span>
        <span class="detail-value">${r.contentType}</span>
      </div>` : ''}
      ${r.postDate ? `
      <div class="detail-row">
        <span class="detail-label">Proposed Go Live Date</span>
        <span class="detail-value">${r.postDate}</span>
      </div>` : ''}
      ${r.caption ? `
      <div class="detail-row">
        <span class="detail-label">Caption Preview</span>
        <span class="detail-value">${r.caption.substring(0, 120)}${r.caption.length > 120 ? '...' : ''}</span>
      </div>` : ''}
    </div>

    <div class="alert alert-info">
      <strong>📆 View your full calendar</strong><br>
      Log in to your dashboard to see all your upcoming content in one place.
    </div>

    <center>
      <a href="${DASHBOARD_URL}" class="button">View My Content Calendar</a>
    </center>

    <div class="alert alert-warning">
      <strong>⚠️ Need to make a change?</strong><br>
      Reply to this email as soon as possible so we can adjust before the post goes live.
    </div>

    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;
  return {
    subject: `Content Scheduled for ${r.postDate} — ${r.idea}`,
    html: getEmailLayout(content)
  };
}

function buildPublished(r) {
  const content = `
    <h2>🎉 Your Content Has Been Published!</h2>
    <p>Hi ${r.clientName},</p>
    <p>Great news — your content has been published and is now live on ${r.platforms}. Here's a summary of what went out.</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Post</span>
        <span class="detail-value">${r.idea}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Platform(s)</span>
        <span class="detail-value">${r.platforms}</span>
      </div>
      ${r.contentType ? `
      <div class="detail-row">
        <span class="detail-label">Content Type</span>
        <span class="detail-value">${r.contentType}</span>
      </div>` : ''}
      ${r.postDate ? `
      <div class="detail-row">
        <span class="detail-label">Published Date</span>
        <span class="detail-value">${r.postDate}</span>
      </div>` : ''}
    </div>

    <div class="alert alert-success">
      <strong>📅 What happens next</strong><br>
      You can view your full content history and upcoming posts in your dashboard at any time.
    </div>

    <center>
      <a href="${DASHBOARD_URL}" class="button">View Your Dashboard</a>
    </center>

    <p>Thank you for trusting Markeb Media with your social media content!</p>
    <p>Best regards,<br><strong>The Markeb Media Team</strong></p>
  `;
  return {
    subject: `Your Content Has Been Published — ${r.idea}`,
    html: getEmailLayout(content)
  };
}

function buildDrafting(r) {
  const content = `
    <h2>✏️ Changes Requested — Content Returned to Draft</h2>
    <p>A client has reviewed their content and requested changes. The post has been moved back to Drafting.</p>

    <div class="booking-details">
      <div class="detail-row">
        <span class="detail-label">Client</span>
        <span class="detail-value">${r.clientName}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Post Idea</span>
        <span class="detail-value">${r.idea}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Platform(s)</span>
        <span class="detail-value">${r.platforms}</span>
      </div>
      ${r.contentType ? `
      <div class="detail-row">
        <span class="detail-label">Content Type</span>
        <span class="detail-value">${r.contentType}</span>
      </div>` : ''}
      ${r.postDate ? `
      <div class="detail-row">
        <span class="detail-label">Proposed Go Live Date</span>
        <span class="detail-value">${r.postDate}</span>
      </div>` : ''}
      ${r.assignee ? `
      <div class="detail-row">
        <span class="detail-label">Assignee</span>
        <span class="detail-value">${r.assignee}</span>
      </div>` : ''}
    </div>

    ${r.notesFromClient ? `
    <div class="alert alert-warning">
      <strong>💬 Client feedback:</strong><br>
      ${r.notesFromClient}
    </div>
    ` : `
    <div class="alert alert-warning">
      <strong>⚠️ No feedback provided</strong><br>
      The client did not leave specific notes. You may want to follow up directly.
    </div>
    `}

    <div class="alert alert-info">
      <strong>📋 Next step</strong><br>
      Please review the client's feedback, make the necessary changes, and move the status back to Ready for Review when done.
    </div>

    <center>
      <a href="${DASHBOARD_URL}" class="button">Open Content Calendar</a>
    </center>
  `;
  return {
    subject: `Changes Requested — ${r.clientName} | ${r.idea}`,
    html: getEmailLayout(content)
  };
}

// ─── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const fields = payload.fields || payload;

  const r = {
    clientName:      fields['Client Name']       || 'there',
    clientEmail:     fields['Email']             || null,
    idea:            fields['Idea']              || 'your post',
    platforms:       Array.isArray(fields['Platform(s)'])
                       ? fields['Platform(s)'].join(', ')
                       : (fields['Platform(s)'] || ''),
    postDate:        fields['Post Date']         || null,
    status:          fields['Status']            || '',
    assignee:        fields['Assignee']          || null,
    contentType:     fields['Content Type']      || null,
    contentPillar:   fields['Content Pillar']    || null,
    caption:         fields['Caption']           || null,
    notesFromClient: fields['Notes from Client'] || null,
  };

  const status = r.status.trim().toLowerCase();

  let toEmail, emailContent;

  if (status === 'ready for review') {
    if (!r.clientEmail) return { statusCode: 400, body: 'No client email on record' };
    toEmail      = r.clientEmail;
    emailContent = buildReadyForReview(r);

  } else if (status === 'approved') {
    toEmail      = INTERNAL_EMAIL;
    emailContent = buildApproved(r);

  } else if (status === 'scheduled') {
    if (!r.clientEmail) return { statusCode: 400, body: 'No client email on record' };
    toEmail      = r.clientEmail;
    emailContent = buildScheduled(r);

  } else if (status === 'published') {
    if (!r.clientEmail) return { statusCode: 400, body: 'No client email on record' };
    toEmail      = r.clientEmail;
    emailContent = buildPublished(r);

  } else if (status === 'drafting') {
    toEmail      = INTERNAL_EMAIL;
    emailContent = buildDrafting(r);

  } else {
    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Status "${r.status}" — no email needed` })
    };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      cc: CC_EMAIL,
      subject: emailContent.subject,
      html: emailContent.html,
    });

    if (error) {
      console.error('Resend error:', error);
      return { statusCode: 500, body: JSON.stringify({ error: 'Email send failed', detail: error }) };
    }

    console.log(`[social-media-status-update] "${r.status}" → ${toEmail} | Resend ID: ${data.id}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, status: r.status, to: toEmail, emailId: data.id })
    };

  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};