// netlify/functions/submit-review.js
// Updates the Client Reviews record in Airtable with split photo/video notes,
// then sends a structured notification email to the Markeb Media team via Resend.

const AIRTABLE_API_KEY  = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID  = process.env.AIRTABLE_BASE_ID;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const TABLE_NAME        = 'Client Reviews';

const TEAM_EMAIL  = process.env.TEAM_NOTIFY_EMAIL  || 'commercial@markebmedia.com';
const FROM_EMAIL  = process.env.RESEND_FROM_EMAIL  || 'notifications@markebmedia.com';

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
      recordId,
      action,           // 'save_notes' | 'approve'
      clientEmail,
      projectAddress,
      photosNotes,      // notes specific to photos
      videoNotes,       // notes specific to video
      photosLink,       // passed through for email context
      videoLink,
    } = JSON.parse(event.body || '{}');

    if (!recordId || !action) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'recordId and action are required' }),
      };
    }

    const statusMap = {
      save_notes: 'Notes Added',
      approve:    'Approved',
    };

    const newStatus = statusMap[action];
    if (!newStatus) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      };
    }

    // ── 1. Build Airtable PATCH payload ───────────────────────────────────
    const airtableFields = {
      'Review Status': newStatus,
      'Submitted At':  new Date().toISOString(),
    };

    if (photosNotes !== undefined) airtableFields['Photos Notes'] = photosNotes;
    if (videoNotes  !== undefined) airtableFields['Video Notes']  = videoNotes;

    const airtableUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NAME)}/${recordId}`;

    const airtableResponse = await fetch(airtableUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: airtableFields }),
    });

    if (!airtableResponse.ok) {
      const err = await airtableResponse.text();
      console.error('Airtable PATCH error:', err);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Failed to update Airtable record' }),
      };
    }

    // ── 2. Build Resend email ─────────────────────────────────────────────
    const isApproval    = action === 'approve';
    const hasPhotos     = !!photosLink;
    const hasVideo      = !!videoLink;
    const hasPhotoNotes = photosNotes && photosNotes.trim().length > 0;
    const hasVideoNotes = videoNotes  && videoNotes.trim().length  > 0;

    const statusBadge = isApproval
      ? `<span style="background:#f3f7e8;color:#3F4D1B;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700;border:1px solid #3F4D1B;">✅ Approved — Ready for Editing</span>`
      : `<span style="background:#fff8ee;color:#8a4a00;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700;border:1px solid #B46100;">📝 Notes Added — Review Before Editing</span>`;

    const headerTitle = isApproval
      ? '✅ Client Approved Content'
      : '📝 Client Review Notes Ready';

    const headerSub = isApproval
      ? 'The client is happy — content is ready to send to the editing team'
      : 'The client has left feedback — review notes before sending to editors';

    // Photo notes block
    const photoNotesBlock = hasPhotos ? `
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="background:#f7ead5;border:1px solid #e8d9be;border-radius:8px;padding:8px 14px;display:inline-flex;align-items:center;gap:8px;">
            <span style="font-size:18px;">📷</span>
            <span style="font-weight:700;color:#3F4D1B;font-size:14px;">Photos</span>
          </div>
          ${hasPhotoNotes
            ? `<span style="background:#fff8ee;color:#8a4a00;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;border:1px solid #B46100;">Has feedback</span>`
            : `<span style="background:#f3f7e8;color:#3F4D1B;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;border:1px solid #3F4D1B;">No issues noted</span>`
          }
        </div>
        ${hasPhotoNotes
          ? `<div style="background:#fff8ee;border:2px solid #B46100;border-radius:10px;padding:16px;">
               <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#8a4a00;text-transform:uppercase;letter-spacing:0.5px;">Client's Photo Feedback</p>
               <p style="margin:0;color:#7a3e00;font-size:14px;line-height:1.7;white-space:pre-wrap;">${photosNotes}</p>
             </div>`
          : `<div style="background:#f3f7e8;border:1.5px solid #3F4D1B;border-radius:10px;padding:14px;color:#3F4D1B;font-size:13px;">
               Client is happy with the photos — no changes requested.
             </div>`
        }
        ${photosLink ? `<div style="margin-top:10px;"><a href="${photosLink}" style="color:#B46100;font-size:13px;font-weight:600;">📂 Open Photos Dropbox Folder →</a></div>` : ''}
      </div>
    ` : '';

    // Video notes block
    const videoNotesBlock = hasVideo ? `
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="background:#f7ead5;border:1px solid #e8d9be;border-radius:8px;padding:8px 14px;display:inline-flex;align-items:center;gap:8px;">
            <span style="font-size:18px;">🎬</span>
            <span style="font-weight:700;color:#3F4D1B;font-size:14px;">Video Clips</span>
          </div>
          ${hasVideoNotes
            ? `<span style="background:#fff8ee;color:#8a4a00;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;border:1px solid #B46100;">Has feedback</span>`
            : `<span style="background:#f3f7e8;color:#3F4D1B;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;border:1px solid #3F4D1B;">No issues noted</span>`
          }
        </div>
        ${hasVideoNotes
          ? `<div style="background:#fff8ee;border:2px solid #B46100;border-radius:10px;padding:16px;">
               <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#8a4a00;text-transform:uppercase;letter-spacing:0.5px;">Client's Video Feedback</p>
               <p style="margin:0;color:#7a3e00;font-size:14px;line-height:1.7;white-space:pre-wrap;">${videoNotes}</p>
             </div>`
          : `<div style="background:#f3f7e8;border:1.5px solid #3F4D1B;border-radius:10px;padding:14px;color:#3F4D1B;font-size:13px;">
               Client is happy with the video clips — no changes requested.
             </div>`
        }
        ${videoLink ? `<div style="margin-top:10px;"><a href="${videoLink}" style="color:#B46100;font-size:13px;font-weight:600;">📂 Open Video Dropbox Folder →</a></div>` : ''}
      </div>
    ` : '';

    const actionBox = isApproval
      ? `<div style="background:#f3f7e8;border:2px solid #3F4D1B;border-radius:12px;padding:20px;text-align:center;margin-top:8px;">
           <p style="margin:0 0 6px;color:#3F4D1B;font-weight:700;font-size:16px;">🎬 Action Required</p>
           <p style="margin:0;color:#6b7c2e;font-size:14px;">Content approved. Send the Dropbox files to the editing team now.</p>
         </div>`
      : `<div style="background:#fff8ee;border:2px solid #B46100;border-radius:12px;padding:20px;text-align:center;margin-top:8px;">
           <p style="margin:0 0 6px;color:#8a4a00;font-weight:700;font-size:16px;">📋 Next Step</p>
           <p style="margin:0;color:#8a4a00;font-size:14px;">Review the client's notes above, then send the Dropbox files to the editing team with this brief attached.</p>
         </div>`;

    const emailHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background-color:#f7ead5;">
  <table role="presentation" style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:40px 20px;text-align:center;background-color:#f7ead5;">
        <table role="presentation" style="max-width:620px;margin:0 auto;background-color:#FDF3E2;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(63,77,27,0.12);">

          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 28px;text-align:center;background:linear-gradient(135deg,#3F4D1B 0%,#2d3813 100%);">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#FDF3E2;letter-spacing:-0.02em;">${headerTitle}</h1>
              <p style="margin:0;color:rgba(253,243,226,0.8);font-size:14px;">${headerSub}</p>
              <div style="width:40px;height:3px;background:#B46100;margin:16px auto 0;border-radius:2px;"></div>
            </td>
          </tr>

          <!-- Project Details -->
          <tr>
            <td style="padding:28px 32px 0;">
              <div style="background:#f7ead5;border:2px solid #e8d9be;border-radius:12px;padding:24px;margin-bottom:20px;">
                <h2 style="color:#3F4D1B;font-size:15px;margin:0 0 16px;font-weight:700;">Project Details</h2>
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#6b7c2e;font-size:13px;width:140px;font-weight:600;">Property</td>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#3F4D1B;font-weight:700;font-size:14px;">${projectAddress || '—'}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#6b7c2e;font-size:13px;font-weight:600;">Client</td>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#3F4D1B;font-size:14px;">${clientEmail || '—'}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#6b7c2e;font-size:13px;font-weight:600;">Media Types</td>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;font-size:14px;">
                      ${hasPhotos ? `<span style="background:#f7ead5;color:#3F4D1B;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;border:1px solid #e8d9be;margin-right:6px;">📷 Photos</span>` : ''}
                      ${hasVideo  ? `<span style="background:#f7ead5;color:#3F4D1B;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;border:1px solid #e8d9be;">🎬 Video</span>` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;color:#6b7c2e;font-size:13px;font-weight:600;">Status</td>
                    <td style="padding:10px 0;border-bottom:1px solid #e8d9be;">${statusBadge}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;color:#6b7c2e;font-size:13px;font-weight:600;">Submitted</td>
                    <td style="padding:10px 0;color:#3F4D1B;font-size:13px;">${new Date().toLocaleString('en-GB')}</td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <!-- Media Feedback -->
          <tr>
            <td style="padding:0 32px;">
              <div style="background:#f7ead5;border:2px solid #e8d9be;border-radius:12px;padding:24px;margin-bottom:20px;">
                <h2 style="color:#3F4D1B;font-size:15px;margin:0 0 20px;font-weight:700;">Client Feedback by Media Type</h2>
                ${photoNotesBlock}
                ${videoNotesBlock}
                ${!hasPhotos && !hasVideo ? '<p style="color:#6b7c2e;font-size:14px;margin:0;">No Dropbox links on this record.</p>' : ''}
              </div>
            </td>
          </tr>

          <!-- Action Box -->
          <tr>
            <td style="padding:0 32px 32px;">
              ${actionBox}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;background-color:#3F4D1B;text-align:center;">
              <p style="margin:0 0 4px;color:#FDF3E2;font-size:13px;font-weight:600;">Markeb Media</p>
              <div style="width:32px;height:2px;background:#B46100;margin:12px auto;border-radius:1px;"></div>
              <p style="margin:0;color:rgba(253,243,226,0.4);font-size:11px;">Client Portal · Automated notification</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const emailSubject = isApproval
      ? `✅ Content Approved – ${projectAddress || 'Project'} – Ready for Editing`
      : `📝 Review Notes Ready – ${projectAddress || 'Project'}${hasPhotoNotes && hasVideoNotes ? ' (Photos + Video)' : hasPhotoNotes ? ' (Photos)' : hasVideoNotes ? ' (Video)' : ''}`;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TEAM_EMAIL],
        subject: emailSubject,
        html: emailHTML,
      }),
    });

    if (!resendResponse.ok) {
      const resendErr = await resendResponse.text();
      console.error('Resend error:', resendErr);
      // Airtable already updated — don't fail the whole request
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          warning: 'Record updated but email notification failed',
          newStatus,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, newStatus }),
    };

  } catch (error) {
    console.error('submit-review error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};