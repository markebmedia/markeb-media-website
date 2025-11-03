// netlify/functions/auth.js - Netlify serverless function for authentication
const bcrypt = require('bcryptjs');

exports.handler = async (event, context) => {
    console.log('=== Netlify Function Debug ===');
    console.log('Method:', event.httpMethod);
    console.log('Path:', event.path);
    console.log('Query:', event.queryStringParameters);
    console.log('Body:', event.body);
    console.log('Environment check:', {
        hasApiKey: !!process.env.AIRTABLE_API_KEY,
        hasBaseId: !!process.env.AIRTABLE_BASE_ID,
        hasTableName: !!process.env.AIRTABLE_USER_TABLE
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