// netlify/functions/update-reserve-privilege.js
// Admin function to toggle "Reserve without payment" privilege for customers
exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const { recordId, email, enabled } = JSON.parse(event.body);

    if (!recordId || !email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Record ID and email required' })
      };
    }

    // Update customer record in Airtable
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    await base(process.env.AIRTABLE_USER_TABLE || 'Markeb Media Users').update(recordId, {
      'Allow Reserve Without Payment': enabled
    });

    console.log(`✓ Reserve privilege ${enabled ? 'enabled' : 'disabled'} for ${email}`);

    // Send notification email to customer
    if (process.env.RESEND_API_KEY) {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);

      // Get customer name
      const customer = await base(process.env.AIRTABLE_USER_TABLE || 'Markeb Media Users').find(recordId);
      const customerName = customer.fields['Name'] || 'Valued Client';

      if (enabled) {
        // Send privilege granted email
        await resend.emails.send({
          from: 'Markeb Media <commercial@markebmedia.com>',
          to: email,
          bcc: 'commercial@markebmedia.com',
          subject: 'Reserve Booking Privilege Enabled',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #3b82f6;">Reserve Booking Privilege Enabled</h2>
              
              <p>Hi ${customerName},</p>
              
              <p>Great news! Your account has been granted the privilege to reserve bookings without immediate payment.</p>
              
              <div style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); border: 2px solid #10b981; border-radius: 12px; padding: 24px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #065f46;">✨ What This Means</h3>
                <p style="color: #065f46; margin-bottom: 0;">You can now book shoots and choose to pay later instead of at the time of booking. You'll receive a payment link after the shoot has been completed.</p>
              </div>
              
              <p><strong>How to use this privilege:</strong></p>
              <ul>
                <li>When booking, select "Reserve (Pay Later)" option</li>
                <li>Complete your booking details</li>
                <li>You'll receive payment instructions after your shoot</li>
              </ul>
              
              <p style="color: #64748b; margin-top: 30px;">
                This privilege can be revoked at any time if payment terms are not met. Please ensure timely payment when invoiced.
              </p>
              
              <p style="color: #64748b;">
                If you have any questions, please contact us at <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
              </p>
              
              <p style="color: #64748b;">
                Best regards,<br>
                The Markeb Media Team
              </p>
            </div>
          `
        });
      } else {
        // Send privilege revoked email
        await resend.emails.send({
          from: 'Markeb Media <commercial@markebmedia.com>',
          to: email,
          bcc: 'commercial@markebmedia.com',
          subject: 'Reserve Booking Privilege Update',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #3b82f6;">Account Update</h2>
              
              <p>Hi ${customerName},</p>
              
              <p>Your account settings have been updated. The "Reserve (Pay Later)" option has been disabled on your account.</p>
              
              <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 12px; padding: 24px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #92400e;">What This Means</h3>
                <p style="color: #92400e; margin-bottom: 0;">When booking shoots, payment will be required at the time of booking. This is our standard booking process.</p>
              </div>
              
              <p>You can still book shoots as normal - payment will simply be processed immediately via our secure Stripe checkout.</p>
              
              <p style="color: #64748b; margin-top: 30px;">
                If you believe this is an error or would like to discuss this change, please contact us at <a href="mailto:commercial@markebmedia.com">commercial@markebmedia.com</a>
              </p>
              
              <p style="color: #64748b;">
                Best regards,<br>
                The Markeb Media Team
              </p>
            </div>
          `
        });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Reserve privilege ${enabled ? 'enabled' : 'disabled'}`,
        enabled: enabled
      })
    };

  } catch (error) {
    console.error('Error updating reserve privilege:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        message: 'Failed to update privilege',
        error: error.message 
      })
    };
  }
};