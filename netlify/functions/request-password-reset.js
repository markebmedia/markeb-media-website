// netlify/functions/request-password-reset.js
const Airtable = require('airtable');
const { Resend } = require('resend');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const resend = new Resend(process.env.RESEND_API_KEY);

function generateResetCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

const resetAttempts = new Map();

function checkRateLimit(email) {
  const now = Date.now();
  const attempts = resetAttempts.get(email) || [];
  const recentAttempts = attempts.filter(timestamp => now - timestamp < 3600000);
  if (recentAttempts.length >= 3) {
    return false;
  }
  recentAttempts.push(now);
  resetAttempts.set(email, recentAttempts);
  return true;
}

exports.handler = async (event) => {
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
    const { email } = JSON.parse(event.body || '{}');

    if (!email) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ message: 'Email is required' }) 
      };
    }

    if (!validateEmail(email)) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ message: 'Invalid email format' }) 
      };
    }

    if (!checkRateLimit(email.toLowerCase())) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ 
          message: 'Too many reset requests. Please try again later.' 
        })
      };
    }

    const records = await base('Markeb Media Users').select({
      filterByFormula: `LOWER({Email}) = "${email.toLowerCase()}"`,
      maxRecords: 1
    }).firstPage();

    if (records.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          message: 'If this email exists, a reset code has been sent.',
          success: true 
        })
      };
    }

    const user = records[0];
    const resetCode = generateResetCode();
    const expiryTime = new Date(Date.now() + 30 * 60 * 1000);

    await base('Markeb Media Users').update(user.id, {
      'Reset Token': resetCode,
      'Reset Token Expiry': expiryTime.toISOString()
    });

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: email.toLowerCase(),
      subject: 'Password Reset Code - Markeb Media',
      html: `
        <h2>Password Reset Request</h2>
        <p>Hello ${user.fields.Name || 'User'},</p>
        <p>Your password reset code is:</p>
        <h1 style="color: #4CAF50; font-size: 32px; letter-spacing: 5px;">${resetCode}</h1>
        <p>This code will expire in 30 minutes.</p>
        <p>If you didn't request this reset, please ignore this email.</p>
        <br>
        <p>Best regards,<br>Markeb Media Team</p>
      `
    });

    console.log('Reset email sent successfully to:', email);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        message: 'Reset code sent to your email.',
        success: true 
      })
    };

  } catch (error) {
    console.error('Request password reset error:', error.message, error.stack);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ 
        message: 'An error occurred. Please try again later.' 
      }) 
    };
  }
};