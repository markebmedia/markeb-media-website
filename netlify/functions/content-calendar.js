// Netlify Function: /.netlify/functions/content-calendar.js
const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userEmail } = JSON.parse(event.body);
    
    if (!userEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Email is required' 
        })
      };
    }

    const AIRTABLE_API_KEY = process.env.SOCIAL_MEDIA_API_KEY;
    const SOCIAL_MEDIA_BASE_ID = process.env.SOCIAL_MEDIA_BASE_ID;
    const CONTENT_TABLE_NAME = 'Content Planner';

    if (!AIRTABLE_API_KEY || !SOCIAL_MEDIA_BASE_ID) {
      throw new Error('Missing Airtable configuration');
    }

    // Filter by Email field in Content Planner
    const filterFormula = `{Email} = '${userEmail.replace(/'/g, "\\'")}'`;
    const url = `https://api.airtable.com/v0/${SOCIAL_MEDIA_BASE_ID}/${encodeURIComponent(CONTENT_TABLE_NAME)}?filterByFormula=${encodeURIComponent(filterFormula)}&sort[0][field]=Post Date&sort[0][direction]=asc`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Airtable API error: ${response.status}`); // ← FIXED HERE
    }

    const data = await response.json();

    // Transform the records into a cleaner format
    const contentItems = (data.records || []).map(record => {
      const fields = record.fields;
      return {
        id: record.id,
        clientName: fields['Client Name'] || '',
        email: fields['Email'] || '',
        idea: fields['Idea'] || '',
        platform: Array.isArray(fields['Platform(s)']) ? fields['Platform(s)'].join(', ') : (fields['Platform(s)'] || ''),
        assignee: fields['Assignee'] || '',
        contentPillar: fields['Content Pillar'] || '',
        contentType: fields['Content Type'] || '',
        postDate: fields['Post Date'] || null,
        status: fields['Status'] || 'Scheduled',
        caption: fields['Caption'] || '',
        mediaLink: fields['Link to Photo/Video/Graphic'] || '',
        notesFromMarkeb: fields['Notes from Markeb'] || '',
        notesFromClient: fields['Notes from Client'] || ''
      };
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        content: contentItems,
        totalItems: contentItems.length
      })
    };

  } catch (error) {
    console.error('Content calendar error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        message: 'Failed to fetch content calendar',
        error: error.message
      })
    };
  }
};