// netlify/functions/acuity-webhook.js
// Webhook that Acuity calls when a new appointment is scheduled

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // Only accept POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse the booking data from Acuity
    const booking = JSON.parse(event.body);
    
    console.log('Acuity webhook received:', {
      id: booking.id,
      email: booking.email,
      datetime: booking.datetime
    });

    // Extract client email
    const clientEmail = booking.email;

    if (!clientEmail) {
      console.error('No email found in booking data');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No email in booking' })
      };
    }

    // Wait a few seconds for Acuity to fully process the booking
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Automatically check for milestone emails
    try {
      const milestoneResponse = await fetch(`${process.env.URL}/.netlify/functions/check-milestone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userEmail: clientEmail
        })
      });

      const milestoneResult = await milestoneResponse.json();
      console.log('Milestone check result:', milestoneResult);

    } catch (milestoneError) {
      // Don't fail the webhook if milestone check fails
      console.error('Milestone check failed:', milestoneError);
    }

    // Return success to Acuity
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Webhook processed successfully',
        email: clientEmail
      })
    };

  } catch (error) {
    console.error('Webhook error:', error);
    
    // Still return 200 to Acuity so they don't retry
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Webhook received but processing failed',
        error: error.message 
      })
    };
  }
};