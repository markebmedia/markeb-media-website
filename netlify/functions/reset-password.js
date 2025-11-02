// netlify/functions/reset-password.js
const Airtable = require('airtable');

// Configure Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

// Hash password (same method as your airtable.js)
function hashPassword(password) {
  return btoa(password + 'salt');
}

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: 'Method not allowed' })
    };
  }

  try {
    const { email, resetCode, newPassword } = JSON.parse(event.body);

    if (!email || !resetCode || !newPassword) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'All fields are required' })
      };
    }

    // Find user in Airtable
    const records = await base('Markeb Media Users').select({
      filterByFormula: `{Email} = "${email}"`,
      maxRecords: 1
    }).firstPage();

    if (records.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Invalid reset request' })
      };
    }

    const user = records[0];
    const storedCode = user.fields['Reset Token'];
    const expiryTime = user.fields['Reset Token Expiry'];

    // Validate reset code
    if (!storedCode || storedCode !== resetCode) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Invalid or expired reset code' })
      };
    }

    // Check if code has expired
    if (expiryTime && new Date(expiryTime) < new Date()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Reset code has expired. Please request a new one.' })
      };
    }

    // Hash new password
    const passwordHash = hashPassword(newPassword);

    // Update user record with new password and clear reset token
    await base('Markeb Media Users').update(user.id, {
      'Password Hash': passwordHash,
      'Reset Token': '',
      'Reset Token Expiry': ''
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Password reset successfully',
        success: true
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: 'Internal server error' })
    };
  }
};