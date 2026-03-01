import crypto from 'crypto';

// Verify HMAC signature for session data
function verifySession(data, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(data));
  const expectedSignature = hmac.digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

export default async function handler(req, res) {
  // Enable CORS with credentials
  // ⚠️ Update with your production domains!
  const allowedOrigins = ['https://yourdomain.com', 'https://www.yourdomain.com', 'http://localhost:8080'];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const SESSION_SECRET = process.env.SESSION_SECRET || process.env.PRIVATE_KEY || 'fallback-secret-key';

  try {
    // Get session cookie
    const cookies = req.headers.cookie || '';
    const sessionMatch = cookies.match(/flapx_session=([^;]+)/);
    const sessionToken = sessionMatch ? sessionMatch[1] : null;

    if (!sessionToken) {
      return res.status(401).json({ error: 'Not authenticated', reason: 'no_session' });
    }

    // Decode and verify session
    let sessionPayload;
    try {
      sessionPayload = JSON.parse(Buffer.from(sessionToken, 'base64url').toString());
    } catch (e) {
      return res.status(401).json({ error: 'Invalid session', reason: 'decode_failed' });
    }

    const { data, sig } = sessionPayload;

    if (!data || !sig) {
      return res.status(401).json({ error: 'Invalid session', reason: 'missing_fields' });
    }

    // Verify signature - this ensures the session was created by our server
    try {
      const isValid = verifySession(data, sig, SESSION_SECRET);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid session', reason: 'bad_signature' });
      }
    } catch (e) {
      return res.status(401).json({ error: 'Invalid session', reason: 'verify_failed' });
    }

    // Check expiration
    if (data.exp && Date.now() > data.exp) {
      return res.status(401).json({ error: 'Session expired', reason: 'expired' });
    }

    // Session is valid - return user data
    res.json({
      success: true,
      user: {
        id: data.id,
        userName: data.username,
        avatar: data.avatar,
      },
    });
  } catch (error) {
    console.error('Session verification error:', error);
    res.status(500).json({ error: 'Session verification failed' });
  }
}
