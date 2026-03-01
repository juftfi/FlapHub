import crypto from 'crypto';

// Generate HMAC signature for session data
function signSession(data, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(data));
  return hmac.digest('hex');
}

export default async function handler(req, res) {
  const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
  const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
  // ⚠️ Set these in Vercel environment variables!
  const TWITTER_CALLBACK_URL = process.env.TWITTER_CALLBACK_URL || 'https://yourdomain.com/api/auth/callback';
  const FRONTEND_URL = process.env.FRONTEND_URL || 'https://yourdomain.com';
  const SESSION_SECRET = process.env.SESSION_SECRET || process.env.PRIVATE_KEY || 'fallback-secret-key';

  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${FRONTEND_URL}?error=${error}`);
    }

    if (!code) {
      return res.redirect(`${FRONTEND_URL}?error=missing_code`);
    }

    // Get code verifier from cookie
    const cookies = req.headers.cookie || '';
    const verifierMatch = cookies.match(/oauth_verifier=([^;]+)/);
    const codeVerifier = verifierMatch ? verifierMatch[1] : null;

    if (!codeVerifier) {
      return res.redirect(`${FRONTEND_URL}?error=missing_verifier`);
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: TWITTER_CALLBACK_URL,
        code_verifier: codeVerifier,
      }).toString(),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error('Token exchange failed:', tokenData);
      return res.redirect(`${FRONTEND_URL}?error=token_exchange_failed`);
    }

    // Get user info from Twitter
    const userResponse = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userResponse.json();

    if (!userResponse.ok || !userData.data) {
      console.error('Failed to get user info:', userData);
      return res.redirect(`${FRONTEND_URL}?error=user_info_failed`);
    }

    const user = userData.data;
    
    // Create signed session token
    // This token contains user data AND a signature that only the server can create
    const sessionData = {
      id: user.id,
      username: user.username,
      avatar: user.profile_image_url || '',
      exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };
    
    // Sign the session data with SESSION_SECRET
    const signature = signSession(sessionData, SESSION_SECRET);
    
    // Combine data + signature
    const sessionToken = Buffer.from(JSON.stringify({
      data: sessionData,
      sig: signature,
    })).toString('base64url');

    // Clear oauth cookie and set secure session cookie
    // ⚠️ NO user info in URL - only indicate login success
    res.setHeader('Set-Cookie', [
      `oauth_verifier=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      `flapx_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
    ]);

    // Only redirect with success flag - NO user data in URL
    res.redirect(`${FRONTEND_URL}?login=success`);
  } catch (error) {
    console.error('Callback error:', error);
    res.redirect(`${FRONTEND_URL}?error=callback_failed`);
  }
}
