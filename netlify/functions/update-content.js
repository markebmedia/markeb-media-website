// Netlify Function: /.netlify/functions/update-content.js
// Allows clients to approve/decline content and add notes
const fetch = require('node-fetch');

const EMAIL_FUNCTION_URL = 'https://markebmedia.com/.netlify/functions/social-media-status-update';

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { recordId, status, notesFromClient } = JSON.parse(event.body);

    if (!recordId) {
      return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Record ID is required' }) };
    }

    const AIRTABLE_API_KEY = process.env.SOCIAL_MEDIA_API_KEY;
    const SOCIAL_MEDIA_BASE_ID = process.env.SOCIAL_MEDIA_BASE_ID;
    const CONTENT_TABLE_NAME = 'Content Planner';

    if (!AIRTABLE_API_KEY || !SOCIAL_MEDIA_BASE_ID) {
      throw new Error('Missing Airtable configuration');
    }

    const fields = {};
    if (status) fields['Status'] = status;
    if (notesFromClient !== undefined) fields['Notes from Client'] = notesFromClient;

    const url = `https://api.airtable.com/v0/${SOCIAL_MEDIA_BASE_ID}/${encodeURIComponent(CONTENT_TABLE_NAME)}/${recordId}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Airtable API error:', response.status, errorText);
      throw new Error(`Airtable API error: ${response.status}`);
    }

    const data = await response.json();
    const updatedFields = data.fields;

    // ─── Fire email for Approved or Drafting (declined) ───────────────────────
    if (status === 'Approved' || status === 'Drafting') {
      try {
        const emailPayload = {
          fields: {
            'Client Name':       updatedFields['Client Name']    || '',
            'Email':             updatedFields['Email']          || '',
            'Idea':              updatedFields['Idea']           || '',
            'Platform(s)':       Array.isArray(updatedFields['Platform(s)'])
                                   ? updatedFields['Platform(s)'].join(', ')
                                   : (updatedFields['Platform(s)'] || ''),
            'Post Date':         updatedFields['Post Date']      || '',
            'Status':            status,
            'Content Type':      updatedFields['Content Type']   || '',
            'Content Pillar':    updatedFields['Content Pillar'] || '',
            'Assignee':          updatedFields['Assignee']       || '',
            'Caption':           updatedFields['Caption']        || '',
            'Notes from Client': notesFromClient                 || '',
          }
        };

        await fetch(EMAIL_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(emailPayload)
        });

        console.log(`[update-content] Email triggered for status "${status}"`);
      } catch (emailError) {
        // Don't fail the whole request if email fails — Airtable was already updated
        console.error('[update-content] Email notification failed:', emailError.message);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        message: 'Content updated successfully',
        record: {
          id: data.id,
          status: data.fields['Status'],
          notesFromClient: data.fields['Notes from Client']
        }
      })
    };

  } catch (error) {
    console.error('Update content error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, message: 'Failed to update content', error: error.message })
    };
  }
};