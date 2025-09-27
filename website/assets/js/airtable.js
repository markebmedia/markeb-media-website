// Direct Airtable integration for immediate functionality
const AIRTABLE_CONFIG = {
  baseId: 'appVzPU0icwL8H6aP',
  tableName: 'Markeb Media Users'
  // apiKey removed — secrets must not be in frontend
};

// Create new user account
async function createUser(userData) {
    try {
        // Check if user already exists
        const filterFormula = `{Email} = "${userData.email}"`;
        const checkUrl = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.tableName}?filterByFormula=${encodeURIComponent(filterFormula)}`;
        
        const checkResponse = await fetch(checkUrl, {
            headers: {
                'Authorization': `Bearer ${AIRTABLE_CONFIG.apiKey}`
            }
        });
        
        const checkResult = await checkResponse.json();
        
        if (checkResult.records && checkResult.records.length > 0) {
            return { 
                success: false, 
                message: 'Account with this email already exists' 
            };
        }
        
        // Create user in Airtable
        const createUrl = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.tableName}`;
        const createData = {
            records: [{
                fields: {
                    'Name': userData.name,
                    'Email': userData.email,
                    'Company': userData.company,
                    'Password Hash': btoa(userData.password + 'salt'), // Simple encoding
                    'Created Date': new Date().toISOString().split('T')[0],
                    'Account Status': 'Active'
                }
            }]
        };
        
        const createResponse = await fetch(createUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(createData)
        });
        
        if (createResponse.ok) {
            const result = await createResponse.json();
            
            // Generate session token
            const sessionData = {
                email: userData.email,
                name: userData.name,
                company: userData.company,
                timestamp: Date.now()
            };
            const token = btoa(JSON.stringify(sessionData));
            
            return { 
                success: true,
                token: token,
                user: {
                    name: userData.name,
                    email: userData.email,
                    company: userData.company
                }
            };
        } else {
            const errorData = await createResponse.json();
            return { 
                success: false, 
                message: 'Failed to create account: ' + (errorData.error?.message || 'Unknown error')
            };
        }
        
    } catch (error) {
        console.error('Registration error:', error);
        return { 
            success: false, 
            message: 'Network error. Please check your connection and try again.' 
        };
    }
}

// Authenticate user
async function authenticateUser(email, password) {
    try {
        const filterFormula = `{Email} = "${email}"`;
        const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.tableName}?filterByFormula=${encodeURIComponent(filterFormula)}`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${AIRTABLE_CONFIG.apiKey}`
            }
        });
        
        const result = await response.json();
        
        if (!result.records || result.records.length === 0) {
            return { 
                success: false, 
                message: 'Invalid email or password' 
            };
        }
        
        const user = result.records[0];
        const storedHash = user.fields['Password Hash'];
        const passwordHash = btoa(password + 'salt');
        
        if (passwordHash !== storedHash) {
            return { 
                success: false, 
                message: 'Invalid email or password' 
            };
        }
        
        // Check account status
        if (user.fields['Account Status'] !== 'Active') {
            return { 
                success: false, 
                message: 'Account is not active' 
            };
        }
        
        // Generate session token
        const sessionData = {
            email: user.fields['Email'],
            name: user.fields['Name'],
            company: user.fields['Company'],
            timestamp: Date.now()
        };
        const token = btoa(JSON.stringify(sessionData));
        
        return {
            success: true,
            token: token,
            user: {
                name: user.fields['Name'],
                email: user.fields['Email'],
                company: user.fields['Company']
            }
        };
        
    } catch (error) {
        console.error('Login error:', error);
        return { 
            success: false, 
            message: 'Network error. Please check your connection and try again.' 
        };
    }
}

// Get user data
async function getUserData(email) {
    try {
        const filterFormula = `{Email} = "${email}"`;
        const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.tableName}?filterByFormula=${encodeURIComponent(filterFormula)}`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${AIRTABLE_CONFIG.apiKey}`
            }
        });
        
        const result = await response.json();
        
        if (!result.records || result.records.length === 0) {
            return { 
                success: false, 
                message: 'User not found' 
            };
        }
        
        const user = result.records[0];
        
        return {
            success: true,
            userData: {
                name: user.fields['Name'],
                email: user.fields['Email'],
                company: user.fields['Company'],
                createdDate: user.fields['Created Date'],
                accountStatus: user.fields['Account Status']
            }
        };
        
    } catch (error) {
        console.error('Get user data error:', error);
        return { 
            success: false, 
            message: 'Failed to load user data' 
        };
    }
}

// Session management functions
function validateSessionToken(token) {
    try {
        const tokenData = JSON.parse(atob(token));
        const now = Date.now();
        const tokenAge = now - tokenData.timestamp;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        if (tokenAge > maxAge) {
            return { valid: false, reason: 'Token expired' };
        }

        return { 
            valid: true, 
            userData: {
                email: tokenData.email,
                name: tokenData.name,
                company: tokenData.company
            }
        };
    } catch (error) {
        return { valid: false, reason: 'Invalid token' };
    }
}

// Check if user is logged in
function isUserLoggedIn() {
    const token = localStorage.getItem('userToken');
    if (!token) return false;

    const validation = validateSessionToken(token);
    if (!validation.valid) {
        // Clean up invalid token
        localStorage.removeItem('userToken');
        localStorage.removeItem('userEmail');
        return false;
    }

    return true;
}

// Get current user from session
function getCurrentUser() {
    const token = localStorage.getItem('userToken');
    if (!token) return null;

    const validation = validateSessionToken(token);
    if (!validation.valid) {
        // Clean up invalid token
        localStorage.removeItem('userToken');
        localStorage.removeItem('userEmail');
        return null;
    }

    return validation.userData;
}

// Store user session securely
function storeUserSession(token, email) {
    localStorage.setItem('userToken', token);
    localStorage.setItem('userEmail', email);
}

// Clear user session
function clearUserSession() {
    localStorage.removeItem('userToken');
    localStorage.removeItem('userEmail');
}

// Logout user
function logoutUser() {
    clearUserSession();
    window.location.href = '../login.html';
}

// Redirect if not authenticated (for protected pages)
function requireAuthentication() {
    if (!isUserLoggedIn()) {
        window.location.href = '../login.html';
        return false;
    }
    return true;
}

// Redirect if already authenticated (for login page)
function redirectIfAuthenticated() {
    if (isUserLoggedIn()) {
        window.location.href = 'website/dashboard.html';
        return true;
    }
    return false;
}

// Form validation helpers
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function validatePassword(password) {
    // Minimum 8 characters, at least one letter and one number
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/;
    return passwordRegex.test(password);
}

function validateRequired(value) {
    return value && value.trim().length > 0;
}

// Export functions for global use
window.AirtableAPI = {
    createUser,
    authenticateUser,
    getUserData,
    isUserLoggedIn,
    getCurrentUser,
    storeUserSession,
    clearUserSession,
    logoutUser,
    requireAuthentication,
    redirectIfAuthenticated,
    validateEmail,
    validatePassword,
    validateRequired
};

// Auto-initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('Direct Airtable API client initialized');
});