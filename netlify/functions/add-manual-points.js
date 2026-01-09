const fetch = require('node-fetch');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_USERS_TABLE = process.env.AIRTABLE_USERS_TABLE || 'Markeb Media Users';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { userEmail, pointsToAdd, addedBy, reason } = JSON.parse(event.body);

    if (!userEmail || !pointsToAdd) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email and points amount are required' })
      };
    }

    // Find the user in Airtable
    const searchUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_USERS_TABLE)}?filterByFormula={Email}="${userEmail}"`;
    
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const searchData = await searchResponse.json();

    if (!searchData.records || searchData.records.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    const userRecord = searchData.records[0];
    const recordId = userRecord.id;
    const currentManualPoints = userRecord.fields['Manual Points'] || 0;
    const newManualTotal = currentManualPoints + parseInt(pointsToAdd);

    // Update the user record with manual points
    const updateUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_USERS_TABLE)}/${recordId}`;
    
    const updateResponse = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          'Manual Points': newManualTotal,
          'Last Manual Points Added': parseInt(pointsToAdd),
          'Last Manual Addition Date': new Date().toISOString(),
          'Manual Addition Reason': reason || 'Admin adjustment'
        }
      })
    });

    if (!updateResponse.ok) {
      throw new Error('Failed to update user record');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true,
        message: 'Points added successfully',
        newTotal: newManualTotal
      })
    };

  } catch (error) {
    console.error('Add manual points error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};