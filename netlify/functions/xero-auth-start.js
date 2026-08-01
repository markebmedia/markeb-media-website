// netlify/functions/xero-auth-start.js
// Triggered by "Connect to Xero" button in admin panel.
// Redirects the admin to Xero's consent screen.

exports.handler = async (event) => {
  const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID;
  const REDIRECT_URI = process.env.XERO_REDIRECT_URI; // e.g. https://yourdomain.com/.netlify/functions/xero-auth-callback

  const scopes = [
    'openid',
    'profile',
    'email',
    'accounting.invoices',
    'accounting.payments',
    'accounting.contacts',
    'offline_access',
  ].join(' ');

  // Basic CSRF protection — generate and check this state value.
  // For simplicity here it's a timestamp; swap in a signed/stored value if you want stricter checking.
  const state = Buffer.from(JSON.stringify({ t: Date.now() })).toString('base64');

  const authUrl = new URL('https://login.xero.com/identity/connect/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', XERO_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);

  return {
    statusCode: 302,
    headers: { Location: authUrl.toString() },
    body: '',
  };
};