// netlify/functions/admin-users.js
// Admin function to retrieve all user accounts

exports.handler = async (event, context) => {
    console.log('=== Admin Users Function ===');
    console.log('Method:', event.httpMethod);

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ 
                success: false, 
                error: 'Method not allowed' 
            })
        };
    }

    // Check for environment variables
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

    try {
        // Fetch all users from Airtable
        const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}?sort%5B0%5D%5Bfield%5D=Created%20Date&sort%5B0%5D%5Bdirection%5D=desc`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable API error:', response.status, errorText);
            throw new Error(`Airtable API error: ${response.status}`);
        }

        const data = await response.json();

        // Return all users (passwords are hashed, so safe to return)
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                users: data.records || [],
                total: data.records?.length || 0
            })
        };

    } catch (error) {
        console.error('Error fetching users:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Failed to load users',
                error: error.message 
            })
        };
    }
};