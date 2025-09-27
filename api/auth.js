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

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
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
            default:
                return res.status(400).json({ error: 'Invalid action' });
        }
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// Hash password securely
async function hashPassword(password) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Verify password
async function verifyPassword(password, hash) {
    const passwordHash = await hashPassword(password);
    return passwordHash === hash;
}

// Handle user login
async function handleLogin(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
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

        const result = await response.json();

        if (result.records.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        const user = result.records[0];
        const storedHash = user.fields['Password Hash'];

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
                message: 'Account is not active' 
            });
        }

        // Generate secure session token (simplified - use JWT in production)
        const sessionData = {
            email: user.fields['Email'],
            name: user.fields['Name'],
            company: user.fields['Company'],
            timestamp: Date.now()
        };

        const token = Buffer.from(JSON.stringify(sessionData)).toString('base64');

        return res.status(200).json({
            success: true,
            token: token,
            user: {
                name: user.fields['Name'],
                email: user.fields['Email'],
                company: user.fields['Company']
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Authentication failed' 
        });
    }
}

// Handle user registration
async function handleRegister(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { name, email, company, password } = req.body;

    if (!name || !email || !company || !password) {
        return res.status(400).json({ error: 'All fields required' });
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

        if (checkResult.records.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Account with this email already exists' 
            });
        }

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Create user in Airtable
        const createUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}`;
        
        const userData = {
            records: [{
                fields: {
                    'Name': name,
                    'Email': email,
                    'Company': company,
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
            throw new Error('Failed to create user');
        }

        const createResult = await createResponse.json();

        // Generate session token
        const sessionData = {
            email: email,
            name: name,
            company: company,
            timestamp: Date.now()
        };

        const token = Buffer.from(JSON.stringify(sessionData)).toString('base64');

        return res.status(201).json({
            success: true,
            token: token,
            user: {
                name: name,
                email: email,
                company: company
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to create account' 
        });
    }
}

// Handle getting user data
async function handleGetUserData(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email required' });
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

        if (result.records.length === 0) {
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
                company: user.fields['Company'],
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