// Netlify Function: /.netlify/functions/update-content.js
// Allows clients to approve/decline content and add notes

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { recordId, status, notesFromClient } = JSON.parse(event.body);
    
    if (!recordId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Record ID is required' 
        })
      };
    }

    // Airtable credentials from environment variables
    const AIRTABLE_API_KEY = process.env.SOCIAL_MEDIA_API_KEY;
    const SOCIAL_MEDIA_BASE_ID = process.env.SOCIAL_MEDIA_BASE_ID;
    const CONTENT_TABLE_NAME = 'Content Planner';

    if (!AIRTABLE_API_KEY || !SOCIAL_MEDIA_BASE_ID) {
      throw new Error('Missing Airtable configuration');
    }

    // Build update payload
    const fields = {};
    
    if (status) {
      fields['Status'] = status;
    }
    
    if (notesFromClient !== undefined) {
      fields['Notes from Client'] = notesFromClient;
    }

    // Update record in Airtable
    const url = `https://api.airtable.com/v0/${SOCIAL_MEDIA_BASE_ID}/${encodeURIComponent(CONTENT_TABLE_NAME)}/${recordId}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Airtable API error:', response.status, errorText);
      throw new Error(`Airtable API error: ${response.status}`);  // ← FIXED THIS LINE
    }

    const data = await response.json();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
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
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        message: 'Failed to update content',
        error: error.message
      })
    };
  }
};