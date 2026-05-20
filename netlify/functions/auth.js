// netlify/functions/auth.js - Netlify serverless function for authentication
// UPDATED: Now creates Dropbox company folder on user registration
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');

// Initialize Resend
let resend;
if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
}

exports.handler = async (event, context) => {
    console.log('=== Netlify Function Debug ===');
    console.log('Method:', event.httpMethod);
    console.log('Path:', event.path);
    console.log('Query:', event.queryStringParameters);
    console.log('Body:', event.body);
    console.log('Environment check:', {
        hasApiKey: !!process.env.AIRTABLE_API_KEY,
        hasBaseId: !!process.env.AIRTABLE_BASE_ID,
        hasTableName: !!process.env.AIRTABLE_USER_TABLE,
        hasResend: !!process.env.RESEND_API_KEY
    });
    console.log('==============================');

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_USER_TABLE) {
        console.error('Missing required environment variables');
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Server configuration error' 
            })
        };
    }

    const action = event.queryStringParameters?.action;

    try {
        switch (action) {
            case 'login':
                return await handleLogin(event, headers);
            case 'register':
                return await handleRegister(event, headers);
            case 'getUserData':
                return await handleGetUserData(event, headers);
            case 'validateToken':
                return await handleValidateToken(event, headers);
            default:
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        success: false, 
                        error: 'Invalid action. Supported actions: login, register, getUserData, validateToken' 
                    })
                };
        }
    } catch (error) {
        console.error('API Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false, 
                error: 'Internal server error' 
            })
        };
    }
};

// Function to send welcome email via Resend
async function sendWelcomeEmail(name, email, company) {
    if (!resend) {
        console.warn('Resend not configured - skipping welcome email');
        return { success: false, reason: 'not configured' };
    }

    try {
        const { data, error } = await resend.emails.send({
            from: 'Markeb Media <commercial@markebmedia.com>',
            to: email,
            bcc: 'commercial@markebmedia.com',
            subject: 'Welcome to Your Markeb Media Dashboard',
            html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f7ead5;">
  <table role="presentation" style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:0;background-color:#f7ead5;">
        <table role="presentation" style="max-width:600px;margin:0 auto;background-color:#FDF3E2;border-radius:0;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:40px 40px 32px;text-align:center;background:linear-gradient(135deg,#3F4D1B 0%,#2d3813 100%);">
              <img src="https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).png" alt="Markeb Media" style="max-width:160px;width:100%;height:auto;margin-bottom:16px;">
              <p style="margin:0;color:rgba(253,243,226,0.8);font-size:15px;">Your dashboard is ready</p>
              <div style="width:40px;height:3px;background:#B46100;margin:16px auto 0;border-radius:2px;"></div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 30px;">
              <p style="margin:0 0 14px;color:#3F4D1B;font-size:16px;line-height:1.6;">Hi ${name},</p>
              <p style="margin:0 0 14px;color:#3F4D1B;font-size:16px;line-height:1.6;">Welcome to Markeb Media. Your personalised client dashboard is now live and ready to use.</p>
              <p style="margin:0 0 24px;color:#3F4D1B;font-size:16px;line-height:1.6;">Here's everything included as a dashboard member:</p>

              <!-- Features table -->
              <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:28px;">
                <tr>
                  <td style="padding:14px 0;border-bottom:1px solid #e8d9be;vertical-align:top;width:36px;">
                    <div style="width:26px;height:26px;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);border-radius:50%;text-align:center;line-height:26px;color:#FDF3E2;font-size:13px;font-weight:700;">✓</div>
                  </td>
                  <td style="padding:14px 0 14px 12px;border-bottom:1px solid #e8d9be;">
                    <strong style="color:#3F4D1B;font-size:15px;display:block;margin-bottom:3px;">Content Gallery & Delivery Tracking</strong>
                    <span style="color:#6b5c3e;font-size:14px;line-height:1.5;">Track every project from shoot to delivery in real time — photos, video, drone and more</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 0;border-bottom:1px solid #e8d9be;vertical-align:top;width:36px;">
                    <div style="width:26px;height:26px;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);border-radius:50%;text-align:center;line-height:26px;color:#FDF3E2;font-size:13px;font-weight:700;">✓</div>
                  </td>
                  <td style="padding:14px 0 14px 12px;border-bottom:1px solid #e8d9be;">
                    <strong style="color:#3F4D1B;font-size:15px;display:block;margin-bottom:3px;">Property Brochure Builder</strong>
                    <span style="color:#6b5c3e;font-size:14px;line-height:1.5;">Create professional PDF and Word brochures from your delivered content — exclusive to dashboard members</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 0;border-bottom:1px solid #e8d9be;vertical-align:top;width:36px;">
                    <div style="width:26px;height:26px;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);border-radius:50%;text-align:center;line-height:26px;color:#FDF3E2;font-size:13px;font-weight:700;">✓</div>
                  </td>
                  <td style="padding:14px 0 14px 12px;border-bottom:1px solid #e8d9be;">
                    <strong style="color:#3F4D1B;font-size:15px;display:block;margin-bottom:3px;">Exclusive Member Pricing</strong>
                    <span style="color:#6b5c3e;font-size:14px;line-height:1.5;">Dashboard members get access to preferential rates not available to walk-in bookings</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 0;border-bottom:1px solid #e8d9be;vertical-align:top;width:36px;">
                    <div style="width:26px;height:26px;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);border-radius:50%;text-align:center;line-height:26px;color:#FDF3E2;font-size:13px;font-weight:700;">✓</div>
                  </td>
                  <td style="padding:14px 0 14px 12px;border-bottom:1px solid #e8d9be;">
                    <strong style="color:#3F4D1B;font-size:15px;display:block;margin-bottom:3px;">Amendment Requests</strong>
                    <span style="color:#6b5c3e;font-size:14px;line-height:1.5;">Submit revision requests directly through the dashboard — no emails back and forth</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 0;border-bottom:1px solid #e8d9be;vertical-align:top;width:36px;">
                    <div style="width:26px;height:26px;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);border-radius:50%;text-align:center;line-height:26px;color:#FDF3E2;font-size:13px;font-weight:700;">✓</div>
                  </td>
                  <td style="padding:14px 0 14px 12px;border-bottom:1px solid #e8d9be;">
                    <strong style="color:#3F4D1B;font-size:15px;display:block;margin-bottom:3px;">AI Copywriting Tool</strong>
                    <span style="color:#6b5c3e;font-size:14px;line-height:1.5;">Generate property descriptions and video scripts in seconds</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 0;vertical-align:top;width:36px;">
                    <div style="width:26px;height:26px;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);border-radius:50%;text-align:center;line-height:26px;color:#FDF3E2;font-size:13px;font-weight:700;">✓</div>
                  </td>
                  <td style="padding:14px 0 14px 12px;">
                    <strong style="color:#3F4D1B;font-size:15px;display:block;margin-bottom:3px;">Social Media Content Calendar</strong>
                    <span style="color:#6b5c3e;font-size:14px;line-height:1.5;">View your full posting schedule and approve content before it goes live</span>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:28px;">
                <tr>
                  <td style="text-align:center;padding:28px;background-color:#f7ead5;border-radius:8px;border:1px solid #e8d9be;">
                    <p style="margin:0 0 16px;color:#3F4D1B;font-size:15px;font-weight:600;">Watch the 2-minute walkthrough to get started</p>
                    <a href="https://youtu.be/aOWwEN_Bv6g" style="display:inline-block;background:linear-gradient(135deg,#B46100 0%,#8a4a00 100%);color:#FDF3E2;text-decoration:none;padding:14px 32px;border-radius:6px;font-weight:700;font-size:15px;">▶ Watch Onboarding Video</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 14px;color:#3F4D1B;font-size:15px;line-height:1.6;">Any questions, reply to this email and we'll get back to you.</p>
              <p style="margin:0;color:#3F4D1B;font-size:15px;line-height:1.6;">The Markeb Media Team</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:28px 40px;background-color:#3F4D1B;">
              <div style="width:32px;height:2px;background:#B46100;margin-bottom:16px;border-radius:1px;"></div>
              <p style="margin:0 0 4px;color:rgba(253,243,226,0.6);font-size:12px;line-height:1.5;">Professional Property Media, Marketing &amp; Technology</p>
              <p style="margin:0;color:rgba(253,243,226,0.4);font-size:12px;">commercial@markebmedia.com</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
        });

        if (error) {
            console.error('Resend error:', error);
            return { success: false, error };
        }

        console.log('Welcome email sent successfully to:', email, '- ID:', data?.id);
        return { success: true, data };
    } catch (error) {
        console.error('Error sending welcome email:', error);
        return { success: false, error: error.message };
    }
}

async function hashPassword(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}

async function verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

async function handleLogin(event, headers) {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ 
                success: false, 
                error: 'Method not allowed' 
            })
        };
    }

    const { email, password } = JSON.parse(event.body);

    if (!email || !password) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Email and password required' 
            })
        };
    }

    try {
        const filterFormula = `LOWER({Email}) = "${email.toLowerCase()}"`;
        const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}?filterByFormula=${encodeURIComponent(filterFormula)}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Airtable API error: ${response.status}`);
        }

        const result = await response.json();

        if (!result.records || result.records.length === 0) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Invalid email or password' 
                })
            };
        }

        const user = result.records[0];
        const storedHash = user.fields['Password Hash'];

        if (!storedHash) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Invalid email or password' 
                })
            };
        }

        const passwordValid = await verifyPassword(password, storedHash);

        if (!passwordValid) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Invalid email or password' 
                })
            };
        }

        if (user.fields['Account Status'] !== 'Active') {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Account is not active. Please contact support.' 
                })
            };
        }

        const sessionData = {
            email: user.fields['Email'],
            name: user.fields['Name'],
            company: user.fields['Company'] || '',
            timestamp: Date.now(),
            expires: Date.now() + (24 * 60 * 60 * 1000)
        };

        const token = Buffer.from(JSON.stringify(sessionData)).toString('base64');

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                token: token,
                user: {
                    name: user.fields['Name'],
                    email: user.fields['Email'],
                    company: user.fields['Company'] || ''
                }
            })
        };

    } catch (error) {
        console.error('Login error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Authentication failed. Please try again.' 
            })
        };
    }
}

async function handleRegister(event, headers) {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ 
                success: false, 
                error: 'Method not allowed' 
            })
        };
    }

    const { name, email, company, region, password } = JSON.parse(event.body);

    if (!name || !email || !company || !password) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'All fields are required' 
            })
        };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Please enter a valid email address' 
            })
        };
    }

    if (password.length < 8) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Password must be at least 8 characters long' 
            })
        };
    }

    try {
        const filterFormula = `LOWER({Email}) = "${email.toLowerCase()}"`;
        const checkUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}?filterByFormula=${encodeURIComponent(filterFormula)}`;

        const checkResponse = await fetch(checkUrl, {
            headers: {
                'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
            }
        });

        const checkResult = await checkResponse.json();

        if (checkResult.records && checkResult.records.length > 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    message: 'An account with this email already exists' 
                })
            };
        }

        const hashedPassword = await hashPassword(password);

        const createUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}`;
        
        const userData = {
            records: [{
                fields: {
                    'Name': name.trim(),
                    'Email': email.toLowerCase().trim(),
                    'Company': company.trim(),
                    'Region': region ? region.trim() : '',
                    'Password Hash': hashedPassword,
                    'Created Date': new Date().toISOString().split('T')[0],
                    'Account Status': 'Active'
                }
            }]
        };

        const createResponse = await fetch(createUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });

        if (!createResponse.ok) {
            const errorData = await createResponse.json();
            console.error('Airtable create error:', errorData);
            throw new Error('Failed to create user account');
        }

        const createResult = await createResponse.json();
        console.log('User account created successfully');

        // ✅ NEW: Create company folder in Dropbox
try {
    const { createFolder } = require('./dropbox-helper');
    const teamFolder = '/Markeb Media Team folder';
    const rawBasePath = `${teamFolder}/Markeb Media Client Folder`;
    const companyFolderPath = `${rawBasePath}/${company.trim()}`;
    await createFolder(companyFolderPath);
    console.log(`✓ Dropbox company folder created: ${companyFolderPath}`);
} catch (dropboxError) {
    console.error('Failed to create company folder in Dropbox:', dropboxError);
    // Don't fail registration if folder creation fails
}

        // Send welcome email (non-blocking - don't wait for it)
        sendWelcomeEmail(name.trim(), email.toLowerCase().trim(), company.trim())
            .catch(error => console.error('Welcome email failed:', error));

        const sessionData = {
            email: email.toLowerCase().trim(),
            name: name.trim(),
            company: company.trim(),
            timestamp: Date.now(),
            expires: Date.now() + (24 * 60 * 60 * 1000)
        };

        const token = Buffer.from(JSON.stringify(sessionData)).toString('base64');

        return {
            statusCode: 201,
            headers,
            body: JSON.stringify({
                success: true,
                token: token,
                user: {
                    name: name.trim(),
                    email: email.toLowerCase().trim(),
                    company: company.trim()
                }
            })
        };

    } catch (error) {
        console.error('Registration error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Failed to create account. Please try again.' 
            })
        };
    }
}

async function handleGetUserData(event, headers) {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ 
                success: false, 
                error: 'Method not allowed' 
            })
        };
    }

    const { email } = JSON.parse(event.body);

    if (!email) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Email required' 
            })
        };
    }

    try {
        const filterFormula = `LOWER({Email}) = "${email.toLowerCase()}"`;
        const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}?filterByFormula=${encodeURIComponent(filterFormula)}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
            }
        });

        const result = await response.json();

        if (!result.records || result.records.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    message: 'User not found' 
                })
            };
        }

        const user = result.records[0];

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                userData: {
                    name: user.fields['Name'],
                    email: user.fields['Email'],
                    company: user.fields['Company'] || '',
                    createdDate: user.fields['Created Date'],
                    accountStatus: user.fields['Account Status']
                }
            })
        };

    } catch (error) {
        console.error('Get user data error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Failed to load user data' 
            })
        };
    }
}

async function handleValidateToken(event, headers) {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ 
                success: false, 
                error: 'Method not allowed' 
            })
        };
    }

    const { token } = JSON.parse(event.body);

    if (!token) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Token required' 
            })
        };
    }

    try {
        const sessionData = JSON.parse(Buffer.from(token, 'base64').toString());
        
        if (sessionData.expires && Date.now() > sessionData.expires) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Token expired' 
                })
            };
        }

        const filterFormula = `LOWER({Email}) = "${sessionData.email.toLowerCase()}"`;
        const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}?filterByFormula=${encodeURIComponent(filterFormula)}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
            }
        });

        const result = await response.json();

        if (!result.records || result.records.length === 0) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    message: 'User not found' 
                })
            };
        }

        const user = result.records[0];

        if (user.fields['Account Status'] !== 'Active') {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Account is not active' 
                })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                valid: true,
                user: {
                    name: user.fields['Name'],
                    email: user.fields['Email'],
                    company: user.fields['Company'] || ''
                }
            })
        };

    } catch (error) {
        console.error('Token validation error:', error);
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Invalid token' 
            })
        };
    }
}