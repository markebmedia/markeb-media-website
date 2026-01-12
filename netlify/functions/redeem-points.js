const fetch = require('node-fetch');
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_USERS_TABLE = process.env.AIRTABLE_USERS_TABLE || 'Markeb Media Users';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { userEmail, redeemedPoints, redeemedValue, acuityTotalInvestment, currentTotalPoints } = JSON.parse(event.body);

    if (!userEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email is required' })
      };
    }

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

    // Calculate how many points to deduct from manual vs baseline
    let newManualPoints = currentManualPoints;
    let newBaseline = userRecord.fields['Last Redemption Total Investment'] || 0;

    // If redeeming all points, reset everything
    if (redeemedPoints >= currentTotalPoints) {
      newManualPoints = 0;
      newBaseline = acuityTotalInvestment || 0;
    } else {
      // Partial redemption - deduct from manual points first
      if (currentManualPoints > 0) {
        if (redeemedPoints <= currentManualPoints) {
          newManualPoints = currentManualPoints - redeemedPoints;
        } else {
          newManualPoints = 0;
          const remainingToRedeem = redeemedPoints - currentManualPoints;
          newBaseline = (userRecord.fields['Last Redemption Total Investment'] || 0) + remainingToRedeem;
        }
      } else {
        // No manual points, deduct from booking baseline
        newBaseline = (userRecord.fields['Last Redemption Total Investment'] || 0) + redeemedPoints;
      }
    }

    const updateUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_USERS_TABLE)}/${recordId}`;
    
    const updateResponse = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          'Manual Points': newManualPoints,
          'Last Redemption Total Investment': newBaseline,
          'Last Points Redeemed': parseInt(redeemedPoints),
          'Last Points Value': parseFloat(redeemedValue),
          'Last Redemption Date': new Date().toISOString(),
          'Total Lifetime Points': (userRecord.fields['Total Lifetime Points'] || 0) + parseInt(redeemedPoints),
          'Last Milestone Reached': 0  // ← ADD THIS LINE TO RESET MILESTONE CYCLE
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
        message: 'Points redeemed successfully',
        milestoneReset: true  // ← OPTIONAL: Confirm milestone was reset
      })
    };

  } catch (error) {
    console.error('Redeem points error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};