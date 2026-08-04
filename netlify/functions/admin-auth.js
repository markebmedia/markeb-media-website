// netlify/functions/admin-auth.js
// Verifies a signed session token issued by admin-login.js.
// Requires env var: ADMIN_SESSION_SECRET

const crypto = require('crypto');

function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig || '');
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (e) { return null; }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const { token } = JSON.parse(event.body || '{}');
  const session = verifySession(token);

  if (!session) {
    await new Promise(r => setTimeout(r, 300));
    return { statusCode: 401, headers, body: JSON.stringify({ success: false }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      name: session.name,
      email: session.email,
      permissions: session.permissions
    })
  };
};