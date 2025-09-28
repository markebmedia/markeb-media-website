// website/assets/js/airtable.js - Frontend API client for Netlify Functions

// Create new user account
async function createUser(userData) {
    try {
        const response = await fetch('/.netlify/functions/auth?action=register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: userData.name,
                email: userData.email,
                company: userData.company,
                password: userData.password
            })
        });

        const result = await response.json();

        if (result.success) {
            return {
                success: true,
                token: result.token,
                user: result.user
            };
        } else {
            return {
                success: false,
                message: result.message || 'Registration failed'
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
        const response = await fetch('/.netlify/functions/auth?action=login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                password: password
            })
        });

        const result = await response.json();

        if (result.success) {
            return {
                success: true,
                token: result.token,
                user: result.user
            };
        } else {
            return {
                success: false,
                message: result.message || 'Login failed'
            };
        }

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
        const response = await fetch('/.netlify/functions/auth?action=getUserData', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email
            })
        });

        const result = await response.json();

        if (result.success) {
            return {
                success: true,
                userData: result.userData
            };
        } else {
            return {
                success: false,
                message: result.message || 'Failed to load user data'
            };
        }

    } catch (error) {
        console.error('Get user data error:', error);
        return {
            success: false,
            message: 'Failed to load user data'
        };
    }
}

// Validate session token with backend
async function validateTokenWithBackend(token) {
    try {
        const response = await fetch('/.netlify/functions/auth?action=validateToken', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                token: token
            })
        });

        const result = await response.json();

        if (result.success && result.valid) {
            return {
                valid: true,
                userData: result.user
            };
        } else {
            return {
                valid: false,
                reason: result.message || 'Token invalid'
            };
        }

    } catch (error) {
        console.error('Token validation error:', error);
        return {
            valid: false,
            reason: 'Network error'
        };
    }
}

// Session management functions
function validateSessionToken(token) {
    try {
        const tokenData = JSON.parse(atob(token));
        const now = Date.now();

        // Check if token has expiry and is expired
        if (tokenData.expires && now > tokenData.expires) {
            return { valid: false, reason: 'Token expired' };
        }

        // Check basic token age (fallback if no expires field)
        if (!tokenData.expires) {
            const tokenAge = now - tokenData.timestamp;
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours

            if (tokenAge > maxAge) {
                return { valid: false, reason: 'Token expired' };
            }
        }

        return {
            valid: true,
            userData: {
                email: tokenData.email,
                name: tokenData.name,
                company: tokenData.company || ''
            }
        };
    } catch (error) {
        return { valid: false, reason: 'Invalid token format' };
    }
}

// Check if user is logged in
async function isUserLoggedIn() {
    const token = localStorage.getItem('userToken');
    if (!token) return false;

    // First check token format locally
    const localValidation = validateSessionToken(token);
    if (!localValidation.valid) {
        // Clean up invalid token
        clearUserSession();
        return false;
    }

    // Then validate with backend (optional - for extra security)
    // Uncomment below for server-side validation on every check
    /*
    const backendValidation = await validateTokenWithBackend(token);
    if (!backendValidation.valid) {
        clearUserSession();
        return false;
    }
    */

    return true;
}

// Get current user from session
function getCurrentUser() {
    const token = localStorage.getItem('userToken');
    if (!token) return null;

    const validation = validateSessionToken(token);
    if (!validation.valid) {
        // Clean up invalid token
        clearUserSession();
        return null;
    }

    return validation.userData;
}

// Store user session securely
function storeUserSession(token, email) {
    localStorage.setItem('userToken', token);
    localStorage.setItem('userEmail', email);
    
    // Optional: Store timestamp for local tracking
    localStorage.setItem('sessionTimestamp', Date.now().toString());
}

// Clear user session
function clearUserSession() {
    localStorage.removeItem('userToken');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('sessionTimestamp');
}

// Logout user
function logoutUser() {
    clearUserSession();
    
    // Determine the correct redirect path based on current location
    const currentPath = window.location.pathname;
    
    if (currentPath.includes('/website/')) {
        // Already in website folder, go up one level
        window.location.href = '../login.html';
    } else {
        // At root level
        window.location.href = 'login.html';
    }
}

// Redirect if not authenticated (for protected pages)
async function requireAuthentication() {
    const loggedIn = await isUserLoggedIn();
    if (!loggedIn) {
        const currentPath = window.location.pathname;
        
        if (currentPath.includes('/website/')) {
            window.location.href = '../login.html';
        } else {
            window.location.href = 'login.html';
        }
        return false;
    }
    return true;
}

// Redirect if already authenticated (for login page)
async function redirectIfAuthenticated() {
    const loggedIn = await isUserLoggedIn();
    if (loggedIn) {
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

// Enhanced error handling
function handleApiError(error, fallbackMessage = 'An error occurred') {
    if (error.message) {
        return error.message;
    }
    
    if (typeof error === 'string') {
        return error;
    }
    
    return fallbackMessage;
}

// Auto-refresh token before expiry (optional feature)
async function refreshTokenIfNeeded() {
    const token = localStorage.getItem('userToken');
    if (!token) return false;

    try {
        const tokenData = JSON.parse(atob(token));
        const now = Date.now();
        
        // Refresh if token expires in next 2 hours
        if (tokenData.expires && (tokenData.expires - now) < (2 * 60 * 60 * 1000)) {
            const currentUser = getCurrentUser();
            if (currentUser) {
                // Re-validate with backend to get fresh token
                const validation = await validateTokenWithBackend(token);
                if (validation.valid) {
                    // Token is still valid, backend might return a new one
                    // This would need backend support for token refresh
                    console.log('Token refresh check completed');
                }
            }
        }
        
        return true;
    } catch (error) {
        console.error('Token refresh error:', error);
        return false;
    }
}

// Export functions for global use
window.AirtableAPI = {
    createUser,
    authenticateUser,
    getUserData,
    validateTokenWithBackend,
    isUserLoggedIn,
    getCurrentUser,
    storeUserSession,
    clearUserSession,
    logoutUser,
    requireAuthentication,
    redirectIfAuthenticated,
    validateEmail,
    validatePassword,
    validateRequired,
    handleApiError,
    refreshTokenIfNeeded
};

// Auto-initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('Markeb Media API client initialized');
    
    // Optional: Auto-refresh token check
    if (getCurrentUser()) {
        refreshTokenIfNeeded();
    }
});