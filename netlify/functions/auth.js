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
            subject: 'Welcome to Your Free Personalised Dashboard',
            html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f7ead5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td style="padding: 40px 0; text-align: center; background-color: #f7ead5;">
                <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #FDF3E2; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(63,77,27,0.12);">

                    <!-- Header -->
                    <tr>
                        <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #3F4D1B 0%, #2d3813 100%);">
                            <h1 style="margin: 0; color: #FDF3E2; font-size: 28px; font-weight: 600; letter-spacing: -0.02em;">Welcome to Markeb Media</h1>
                            <p style="margin: 10px 0 0; color: #FDF3E2; font-size: 16px; opacity: 0.85;">Your Personalised Dashboard is Ready</p>
                            <!-- Amber accent bar -->
                            <div style="width: 40px; height: 3px; background: #B46100; margin: 16px auto 0; border-radius: 2px;"></div>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <p style="margin: 0 0 20px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Hi ${name},</p>

                            <p style="margin: 0 0 25px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Welcome to Markeb Media! We're delighted to have you on board.</p>

                            <p style="margin: 0 0 25px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Your <strong>free personalised dashboard</strong> is now active, giving you access to exclusive bonus features designed to streamline your content creation and property marketing.</p>

                            <!-- Video Section -->
                            <div style="margin: 30px 0; text-align: center; background-color: #f7ead5; padding: 30px; border-radius: 8px; border: 1px solid #e8d9be;">
                                <h2 style="margin: 0 0 15px; color: #3F4D1B; font-size: 20px; font-weight: 600;">Quick Start Guide</h2>
                                <p style="margin: 0 0 20px; color: #6b7c2e; font-size: 14px;">Watch this 2-minute video to get the most out of your dashboard</p>
                                <a href="https://youtu.be/5u-AC-X7juk" style="display: inline-block; background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); color: #FDF3E2; text-decoration: none; padding: 15px 35px; border-radius: 6px; font-weight: 600; font-size: 16px;">▶ Watch Onboarding Video</a>
                            </div>

                            <h3 style="margin: 30px 0 20px; color: #3F4D1B; font-size: 18px; font-weight: 600;">Your Dashboard Features:</h3>

                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 12px 0; vertical-align: top; width: 42px;">
                                        <div style="width: 30px; height: 30px; background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); border-radius: 50%; text-align: center; line-height: 30px; color: #FDF3E2; font-weight: 600;">✓</div>
                                    </td>
                                    <td style="padding: 12px 0;">
                                        <strong style="color: #3F4D1B; font-size: 15px;">Track Content Progress</strong>
                                        <p style="margin: 5px 0 0; color: #6b7c2e; font-size: 14px; line-height: 1.5;">See real-time updates on all your property content projects from brief to delivery</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px 0; vertical-align: top; width: 42px;">
                                        <div style="width: 30px; height: 30px; background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); border-radius: 50%; text-align: center; line-height: 30px; color: #FDF3E2; font-weight: 600;">✓</div>
                                    </td>
                                    <td style="padding: 12px 0;">
                                        <strong style="color: #3F4D1B; font-size: 15px;">Request Amendments</strong>
                                        <p style="margin: 5px 0 0; color: #6b7c2e; font-size: 14px; line-height: 1.5;">Submit revision requests directly through your dashboard with instant notifications to our team</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px 0; vertical-align: top; width: 42px;">
                                        <div style="width: 30px; height: 30px; background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); border-radius: 50%; text-align: center; line-height: 30px; color: #FDF3E2; font-weight: 600;">✓</div>
                                    </td>
                                    <td style="padding: 12px 0;">
                                        <strong style="color: #3F4D1B; font-size: 15px;">AI Copywriting Tool</strong>
                                        <p style="margin: 5px 0 0; color: #6b7c2e; font-size: 14px; line-height: 1.5;">Generate compelling property descriptions and video scripts in seconds with our AI assistant</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px 0; vertical-align: top; width: 42px;">
                                        <div style="width: 30px; height: 30px; background: linear-gradient(135deg, #B46100 0%, #8a4a00 100%); border-radius: 50%; text-align: center; line-height: 30px; color: #FDF3E2; font-weight: 600;">✓</div>
                                    </td>
                                    <td style="padding: 12px 0;">
                                        <strong style="color: #3F4D1B; font-size: 15px;">Content Calendar</strong>
                                        <p style="margin: 5px 0 0; color: #6b7c2e; font-size: 14px; line-height: 1.5;">View your complete posting schedule and upcoming content when we manage your social media</p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Pro Tip -->
                            <div style="margin: 35px 0 25px; padding: 20px; background-color: #fff8ee; border-left: 4px solid #B46100; border-radius: 4px;">
                                <p style="margin: 0; color: #3F4D1B; font-size: 15px; line-height: 1.6;"><strong>💡 Pro Tip:</strong> Bookmark your dashboard for quick access. All your content, analytics, and tools are just one click away!</p>
                            </div>

                            <p style="margin: 0 0 20px; color: #3F4D1B; font-size: 16px; line-height: 1.6;">If you have any questions or need assistance navigating your dashboard, our team is here to help.</p>

                            <p style="margin: 0; color: #3F4D1B; font-size: 16px; line-height: 1.6;">Looking forward to creating outstanding content together!</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; background-color: #3F4D1B; border-top: 1px solid #2d3813;">
                            <p style="margin: 0 0 10px; color: #FDF3E2; font-size: 14px; font-weight: 600;">Best regards,</p>
                            <p style="margin: 0 0 6px; color: rgba(253,243,226,0.75); font-size: 14px;">The Markeb Media Team</p>
                            <!-- Amber divider -->
                            <div style="width: 32px; height: 2px; background: #B46100; margin: 16px 0; border-radius: 1px;"></div>
                            <p style="margin: 0 0 6px; color: rgba(253,243,226,0.5); font-size: 12px; line-height: 1.5;">Professional Property Media, Marketing &amp; Technology Solution</p>
                            <p style="margin: 0; color: rgba(253,243,226,0.4); font-size: 12px; line-height: 1.5;">This dashboard is a complimentary feature included with your Markeb Media service package.</p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>
            `
        });

        if (error) {
            console.error('Resend error:', error);
            return { success: false, error };
        }

        console.log('Welcome email sent successfully to:', email, '- ID:', data?.id);
        return { success: true, data };
    } catch (error) {
        console.error('Error sending welcome email:', error);
        // Don't fail registration if email fails
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

    const { name, email, company, password } = JSON.parse(event.body);

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