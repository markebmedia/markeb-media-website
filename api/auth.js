// api/auth.js - Vercel serverless function for secure authentication

export default async function handler(req, res) {
    // Debug logging
    console.log('=== API Request Debug ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Query:', req.query);
    console.log('Body:', req.body);
    console.log('Environment check:', {
        hasApiKey: !!process.env.AIRTABLE_API_KEY,
        hasBaseId: !!process.env.AIRTABLE_BASE_ID,
        hasTableName: !!process.env.AIRTABLE_USER_TABLE
    });
    console.log('========================');

    // Enable CORS for all domains in development, restrict in production
    const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:8080',
        'https://markeb-media-website.vercel.app',
        'https://markebmedia.com',
        'https://www.markebmedia.com'
    ];
    
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Validate environment variables
    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_USER_TABLE) {
        console.error('Missing required environment variables');
        return res.status(500).json({ 
            success: false, 
            message: 'Server configuration error' 
        });
    }

    const { action } = req.query;

    try {
        switch (action) {
            case 'login':
                return await handleLogin(req, res);
            case 'register':
                return await handleRegister(req, res);
            case 'getUserData':
                return await handleGetUserData(req, res);
            case 'validateToken':
                return await handleValidateToken(req, res);
            default:
                return res.status(400).json({ 
                    success: false, 
                    error: 'Invalid action. Supported actions: login, register, getUserData, validateToken' 
                });
        }
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
}

// Hash password securely
async function hashPassword(password) {
    const crypto = require('crypto');
    // Add a salt for better security
    const salt = 'markeb_media_salt_2024';
    return crypto.createHash('sha256').update(password + salt).digest('hex');
}

// Verify password
async function verifyPassword(password, hash) {
    const passwordHash = await hashPassword(password);
    return passwordHash === hash;
}

// Handle user login
async function handleLogin(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            error: 'Method not allowed' 
        });
    }

    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'Email and password required' 
        });
    }

    try {
        // Query Airtable
        const filterFormula = `{Email} = "${email}"`;
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
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        const user = result.records[0];
        const storedHash = user.fields['Password Hash'];

        if (!storedHash) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        // Verify password
        const passwordValid = await verifyPassword(password, storedHash);

        if (!passwordValid) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        // Check account status
        if (user.fields['Account Status'] !== 'Active') {
            return res.status(401).json({ 
                success: false, 
                message: 'Account is not active. Please contact support.' 
            });
        }

        // Generate secure session token
        const sessionData = {
            email: user.fields['Email'],
            name: user.fields['Name'],
            company: user.fields['Company'] || '',
            timestamp: Date.now(),
            expires: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
        };

        const token = Buffer.from(JSON.stringify(sessionData)).toString('base64');

        return res.status(200).json({
            success: true,
            token: token,
            user: {
                name: user.fields['Name'],
                email: user.fields['Email'],
                company: user.fields['Company'] || ''
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Authentication failed. Please try again.' 
        });
    }
}

// Handle user registration
async function handleRegister(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            error: 'Method not allowed' 
        });
    }

    const { name, email, company, password } = req.body;

    if (!name || !email || !company || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'All fields are required' 
        });
    }

    // Basic validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Please enter a valid email address' 
        });
    }

    if (password.length < 8) {
        return res.status(400).json({ 
            success: false, 
            message: 'Password must be at least 8 characters long' 
        });
    }

    try {
        // Check if user already exists
        const filterFormula = `{Email} = "${email}"`;
        const checkUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}?filterByFormula=${encodeURIComponent(filterFormula)}`;

        const checkResponse = await fetch(checkUrl, {
            headers: {
                'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
            }
        });

        const checkResult = await checkResponse.json();

        if (checkResult.records && checkResult.records.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'An account with this email already exists' 
            });
        }

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Create user in Airtable
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

        // Generate session token
        const sessionData = {
            email: email.toLowerCase().trim(),
            name: name.trim(),
            company: company.trim(),
            timestamp: Date.now(),
            expires: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
        };

        const token = Buffer.from(JSON.stringify(sessionData)).toString('base64');

        return res.status(201).json({
            success: true,
            token: token,
            user: {
                name: name.trim(),
                email: email.toLowerCase().trim(),
                company: company.trim()
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to create account. Please try again.' 
        });
    }
}

// Handle getting user data
async function handleGetUserData(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            error: 'Method not allowed' 
        });
    }

    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ 
            success: false, 
            message: 'Email required' 
        });
    }

    try {
        const filterFormula = `{Email} = "${email}"`;
        const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}?filterByFormula=${encodeURIComponent(filterFormula)}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
            }
        });

        const result = await response.json();

        if (!result.records || result.records.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        const user = result.records[0];

        return res.status(200).json({
            success: true,
            userData: {
                name: user.fields['Name'],
                email: user.fields['Email'],
                company: user.fields['Company'] || '',
                createdDate: user.fields['Created Date'],
                accountStatus: user.fields['Account Status']
            }
        });

    } catch (error) {
        console.error('Get user data error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to load user data' 
        });
    }
}

// Handle token validation
async function handleValidateToken(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            error: 'Method not allowed' 
        });
    }

    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ 
            success: false, 
            message: 'Token required' 
        });
    }

    try {
        const sessionData = JSON.parse(Buffer.from(token, 'base64').toString());
        
        // Check if token is expired
        if (sessionData.expires && Date.now() > sessionData.expires) {
            return res.status(401).json({ 
                success: false, 
                message: 'Token expired' 
            });
        }

        // Verify user still exists and is active
        const filterFormula = `{Email} = "${sessionData.email}"`;
        const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}?filterByFormula=${encodeURIComponent(filterFormula)}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
            }
        });

        const result = await response.json();

        if (!result.records || result.records.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        const user = result.records[0];

        if (user.fields['Account Status'] !== 'Active') {
            return res.status(401).json({ 
                success: false, 
                message: 'Account is not active' 
            });
        }

        return res.status(200).json({
            success: true,
            valid: true,
            user: {
                name: user.fields['Name'],
                email: user.fields['Email'],
                company: user.fields['Company'] || ''
            }
        });

    } catch (error) {
        console.error('Token validation error:', error);
        return res.status(401).json({ 
            success: false, 
            message: 'Invalid token' 
        });
    }
}