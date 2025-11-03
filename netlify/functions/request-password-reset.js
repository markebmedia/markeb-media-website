// netlify/functions/request-password-reset.js
const Airtable = require('airtable');
const fetch = require('node-fetch');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

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

    // Use EmailJS server-side endpoint with private key
    const emailResponse = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        accessToken: process.env.EMAILJS_PRIVATE_KEY,
        template_params: {
          to_email: email.toLowerCase(),
          to_name: user.fields.Name || 'User',
          reset_code: resetCode,
          expiry_minutes: '30'
        }
      })
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error('EmailJS send failed:', errorText);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          message: 'If this email exists, a reset code has been sent.',
          success: true 
        })
      };
    }

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