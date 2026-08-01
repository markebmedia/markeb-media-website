// netlify/functions/xero-refresh-token.js
// Scheduled function — keeps the Xero connection alive.
// Xero refresh tokens expire after 60 days of inactivity, so this also
// protects against the connection going stale if invoices aren't pushed often.
//
// Add to netlify.toml:
// [[functions]]
//   schedule = "0 3 * * *"   # daily at 3am
//   path = "/xero-refresh-token"

const { refreshAccessToken } = require('../../lib/xero-client');

exports.handler = async () => {
  try {
    await refreshAccessToken();
    return { statusCode: 200, body: 'Xero token refreshed' };
  } catch (err) {
    console.error('Scheduled Xero refresh failed:', err);
    // Consider alerting yourself here (email/Slack) since a failed refresh
    // this far ahead of expiry usually means the connection needs re-authorising.
    return { statusCode: 500, body: err.message };
  }
};