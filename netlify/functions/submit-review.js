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
    const isApproval  = action === 'approve';
    const hasPhotos   = !!photosLink;
    const hasVideo    = !!videoLink;
    const hasPhotoNotes = photosNotes && photosNotes.trim().length > 0;
    const hasVideoNotes = videoNotes  && videoNotes.trim().length  > 0;

    const statusBadge = isApproval
      ? `<span style="background:#d1fae5;color:#065f46;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700;">✅ Approved — Ready for Editing</span>`
      : `<span style="background:#dbeafe;color:#1e40af;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700;">📝 Notes Added — Review Before Editing</span>`;

    const headerGradient = isApproval
      ? 'linear-gradient(135deg, #10b981, #059669)'
      : 'linear-gradient(135deg, #3b82f6, #2563eb)';

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
          <div style="background:#dbeafe;border-radius:8px;padding:8px 14px;display:inline-flex;align-items:center;gap:8px;">
            <span style="font-size:18px;">📷</span>
            <span style="font-weight:700;color:#1e40af;font-size:14px;">Photos</span>
          </div>
          ${hasPhotoNotes
            ? `<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;">Has feedback</span>`
            : `<span style="background:#f0fdf4;color:#166534;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;">No issues noted</span>`
          }
        </div>
        ${hasPhotoNotes
          ? `<div style="background:#fffbeb;border:2px solid #fbbf24;border-radius:10px;padding:16px;">
               <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">Client's Photo Feedback</p>
               <p style="margin:0;color:#78350f;font-size:14px;line-height:1.7;white-space:pre-wrap;">${photosNotes}</p>
             </div>`
          : `<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:14px;color:#166534;font-size:13px;">
               Client is happy with the photos — no changes requested.
             </div>`
        }
        ${photosLink ? `<div style="margin-top:10px;"><a href="${photosLink}" style="color:#2563eb;font-size:13px;font-weight:600;">📂 Open Photos Dropbox Folder →</a></div>` : ''}
      </div>
    ` : '';

    // Video notes block
    const videoNotesBlock = hasVideo ? `
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="background:#f3e8ff;border-radius:8px;padding:8px 14px;display:inline-flex;align-items:center;gap:8px;">
            <span style="font-size:18px;">🎬</span>
            <span style="font-weight:700;color:#6d28d9;font-size:14px;">Video Clips</span>
          </div>
          ${hasVideoNotes
            ? `<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;">Has feedback</span>`
            : `<span style="background:#f0fdf4;color:#166534;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;">No issues noted</span>`
          }
        </div>
        ${hasVideoNotes
          ? `<div style="background:#fffbeb;border:2px solid #fbbf24;border-radius:10px;padding:16px;">
               <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">Client's Video Feedback</p>
               <p style="margin:0;color:#78350f;font-size:14px;line-height:1.7;white-space:pre-wrap;">${videoNotes}</p>
             </div>`
          : `<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:14px;color:#166534;font-size:13px;">
               Client is happy with the video clips — no changes requested.
             </div>`
        }
        ${videoLink ? `<div style="margin-top:10px;"><a href="${videoLink}" style="color:#2563eb;font-size:13px;font-weight:600;">📂 Open Video Dropbox Folder →</a></div>` : ''}
      </div>
    ` : '';

    const actionBox = isApproval
      ? `<div style="background:#eff6ff;border:2px solid #3b82f6;border-radius:12px;padding:20px;text-align:center;margin-top:8px;">
           <p style="margin:0 0 6px;color:#1e40af;font-weight:700;font-size:16px;">🎬 Action Required</p>
           <p style="margin:0;color:#1e40af;font-size:14px;">Content approved. Send the Dropbox files to the editing team now.</p>
         </div>`
      : `<div style="background:#eff6ff;border:2px solid #3b82f6;border-radius:12px;padding:20px;text-align:center;margin-top:8px;">
           <p style="margin:0 0 6px;color:#1e40af;font-weight:700;font-size:16px;">📋 Next Step</p>
           <p style="margin:0;color:#1e40af;font-size:14px;">Review the client's notes above, then send the Dropbox files to the editing team with this brief attached.</p>
         </div>`;

    const emailHTML = `
      <div style="font-family:Inter,sans-serif;max-width:620px;margin:0 auto;background:#f8fafc;padding:32px;border-radius:12px;">

        <!-- Header -->
        <div style="background:${headerGradient};border-radius:12px;padding:28px;color:#fff;margin-bottom:24px;">
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;">${headerTitle}</h1>
          <p style="margin:0;opacity:0.9;font-size:14px;">${headerSub}</p>
        </div>

        <!-- Project details -->
        <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e2e8f0;margin-bottom:20px;">
          <h2 style="color:#1e293b;font-size:15px;margin:0 0 16px;font-weight:700;">Project Details</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0;color:#64748b;font-size:13px;width:140px;">Property</td>
              <td style="padding:8px 0;color:#1e293b;font-weight:700;font-size:14px;">${projectAddress || '—'}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#64748b;font-size:13px;">Client</td>
              <td style="padding:8px 0;color:#1e293b;font-size:14px;">${clientEmail || '—'}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#64748b;font-size:13px;">Media types</td>
              <td style="padding:8px 0;font-size:14px;">
                ${hasPhotos ? '<span style="background:#dbeafe;color:#1e40af;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;margin-right:6px;">📷 Photos</span>' : ''}
                ${hasVideo  ? '<span style="background:#f3e8ff;color:#6d28d9;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;">🎬 Video</span>' : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#64748b;font-size:13px;">Status</td>
              <td style="padding:8px 0;">${statusBadge}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#64748b;font-size:13px;">Submitted</td>
              <td style="padding:8px 0;color:#1e293b;font-size:13px;">${new Date().toLocaleString('en-GB')}</td>
            </tr>
          </table>
        </div>

        <!-- Media feedback blocks -->
        <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e2e8f0;margin-bottom:20px;">
          <h2 style="color:#1e293b;font-size:15px;margin:0 0 20px;font-weight:700;">Client Feedback by Media Type</h2>
          ${photoNotesBlock}
          ${videoNotesBlock}
          ${!hasPhotos && !hasVideo ? '<p style="color:#64748b;font-size:14px;margin:0;">No Dropbox links on this record.</p>' : ''}
        </div>

        <!-- Action box -->
        ${actionBox}

        <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:24px;">
          Markeb Media Client Portal &bull; Automated notification
        </p>
      </div>
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