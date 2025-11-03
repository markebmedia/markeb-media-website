// netlify/functions/reset-password.js
const Airtable = require('airtable');
const bcrypt = require('bcryptjs');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

async function hashPassword(password) {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

function validatePassword(password) {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }
  return { valid: true };
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

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

    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.valid) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: passwordCheck.message })
      };
    }

    const records = await base('Markeb Media Users').select({
      filterByFormula: `LOWER({Email}) = "${email.toLowerCase()}"`,
      maxRecords: 1
    }).firstPage();

    if (records.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Invalid or expired reset code' })
      };
    }

    const user = records[0];
    const storedCode = user.fields['Reset Token'];
    const expiryTime = user.fields['Reset Token Expiry'];

    if (!storedCode || storedCode !== resetCode) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Invalid or expired reset code' })
      };
    }

    if (expiryTime && new Date(expiryTime) < new Date()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Reset code has expired. Please request a new one.' })
      };
    }

    const passwordHash = await hashPassword(newPassword);

    const updateFields = {
      'Password Hash': passwordHash,
      'Reset Token': ''
    };

    if (user.fields['Reset Token Expiry']) {
      updateFields['Reset Token Expiry'] = null;
    }

    await base('Markeb Media Users').update(user.id, updateFields);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Password reset successfully',
        success: true
      })
    };

  } catch (error) {
    console.error('Reset password error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: 'Internal server error' })
    };
  }
};